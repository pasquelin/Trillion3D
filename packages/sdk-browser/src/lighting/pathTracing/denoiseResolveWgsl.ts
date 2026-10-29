import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { DN_COLOR_WGSL } from './denoiseColorWgsl.ts'
import { DN_PARAMS_WGSL } from './denoiseMotionWgsl.ts'

export const DN_RESOLVE_ENTRIES = {
  reject: 'dnReject',
  resolve: 'dnResolve',
  fusion: 'dnFusion',
} as const

/** What the prepass keeps of a pixel: the running mean and the sum of squared deviations (four channels each). */
export const DN_FINGERPRINT_BYTES = 32

const REJECT_WGSL = `@group(0) @binding(1) var dnOffsets:texture_2d<f32>;
@group(0) @binding(2) var dnFrom:texture_2d<f32>;
@group(0) @binding(3) var dnTo:texture_2d<f32>;
@group(0) @binding(4) var dnRejectOut:texture_storage_2d<rgba32float,write>;
@compute @workgroup_size(8,8,1)
fn ${DN_RESOLVE_ENTRIES.reject}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=dn.size)){return;}
 let off=dnOffsetFromLower(dnOffsets,vec2f(id.xy),0u);
 let extent=vec2f(dn.size);
 let warped=dnBicubic(dnFrom,0,(vec2f(id.xy)+off.xy+vec2f(0.5))/extent,extent);
 let now=textureLoad(dnTo,vec2i(id.xy),0);
 let delta=dnDeltaE(warped.rgb*dn.exposure,now.rgb*dn.exposure);
 textureStore(dnRejectOut,vec2i(id.xy),vec4f(delta,select(0.0,1.0,delta>=DN_DELTA_E_SCALE*dn.cutoff),luminance(warped.rgb),luminance(now.rgb)));
}`

const RESOLVE_WGSL = `@group(0) @binding(1) var dnOffsets:texture_2d<f32>;
@group(0) @binding(2) var dnFrom:texture_2d<f32>;
@group(0) @binding(3) var dnTo:texture_2d<f32>;
@group(0) @binding(4) var dnReject:texture_2d<f32>;
@group(0) @binding(5) var dnBase:texture_2d<f32>;
@group(0) @binding(6) var dnResolveOut:texture_storage_2d<rgba32float,write>;
@compute @workgroup_size(8,8,1)
fn ${DN_RESOLVE_ENTRIES.resolve}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=dn.size)){return;}
 let at=vec2i(id.xy);
 let off=dnOffsetFromLower(dnOffsets,vec2f(id.xy),0u);
 let extent=vec2f(dn.size);
 let history=dnBicubic(dnFrom,0,(vec2f(id.xy)+off.xy+vec2f(0.5))/extent,extent);
 var m=max(dn.kappa*(off.dist-dn.eta),0.0);
 m=2.0*m/(1.0+m);
 var weight=clamp(dn.alpha*(1.0-m)*off.tv,0.0,1.0);
 let error=textureLoad(dnReject,at,0).x;
 if(error>=DN_DELTA_E_SCALE*dn.cutoff){weight=min(weight,DN_DELTA_E_SCALE*0.5/error);}
 if(error>=DN_DELTA_E_SCALE*10.0){weight=0.0;}
 let now=textureLoad(dnTo,at,0);
 if(dn.patchCount==1u){
  let blended=(1.0-weight)*now+weight*history;
  textureStore(dnResolveOut,at,vec4f(max(blended.xyz,vec3f(0.0)),blended.w));
  return;
 }
 var sum=now;
 var total=select(now.w,1.0,dn.patchId==0u);
 sum+=weight*history;
 total+=weight;
 if(dn.patchId+1u==dn.patchCount){
  sum=sum/total;
  textureStore(dnResolveOut,at,vec4f(max(sum.xyz,vec3f(0.0)),textureLoad(dnBase,at,0).w));
 }else{
  textureStore(dnResolveOut,at,vec4f(max(sum.xyz,vec3f(0.0)),total));
 }
}`

const FUSION_WGSL = `struct DnFingerprint{mean:vec4f,spread:vec4f}
@group(0) @binding(1) var<storage,read> dnVarianceLast:array<DnFingerprint>;
@group(0) @binding(2) var<storage,read> dnVarianceNow:array<DnFingerprint>;
@group(0) @binding(3) var dnFusionFrom:texture_storage_2d<rgba32float,write>;
@group(0) @binding(4) var dnFusionTo:texture_storage_2d<rgba32float,write>;
fn dnFuse(f:DnFingerprint)->vec4f{
 return vec4f(sqrt(max(f.spread.rgb,vec3f(0.0))/(f.mean.w+1.0)),0.0);
}
@compute @workgroup_size(8,8,1)
fn ${DN_RESOLVE_ENTRIES.fusion}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=dn.size)){return;}
 let index=id.x+id.y*dn.size.x;
 textureStore(dnFusionFrom,vec2i(id.xy),dnFuse(dnVarianceLast[index]));
 textureStore(dnFusionTo,vec2i(id.xy),dnFuse(dnVarianceNow[index]));
}`

/** The kernels that finish the temporal stage: the colour difference between the warped history and the new image, the blend of the two, and the fusion of the variances as a feature to find the motion on. */
export const DN_RESOLVE_PROGRAMS = {
  reject: wgslProgram(REJECT_WGSL, [DN_PARAMS_WGSL, DN_COLOR_WGSL]),
  resolve: wgslProgram(RESOLVE_WGSL, [DN_PARAMS_WGSL, DN_COLOR_WGSL]),
  fusion: wgslProgram(FUSION_WGSL, [DN_PARAMS_WGSL]),
} as const
