import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { DN_PARAMS_WGSL } from './denoiseMotionWgsl.ts'

export const DN_PREPASS_ENTRIES = { prepass: 'dnPrepass', texture: 'dnVarianceTexture' } as const

/** The bits of `DnParams.flags` the prepass reads: the single-channel variance type, the ranked luminance. */
export const DN_FLAG_SINGLE_CHANNEL = 4
export const DN_FLAG_RANKED = 8

const FINGERPRINT = `struct DnFingerprint{mean:vec4f,spread:vec4f}`

const PREPASS_WGSL = `${FINGERPRINT}
@group(0) @binding(1) var dnRadiance:texture_2d<f32>;
@group(0) @binding(2) var dnAlbedo:texture_2d<f32>;
@group(0) @binding(3) var dnNormal:texture_2d<f32>;
@group(0) @binding(4) var<storage,read_write> dnVarianceMap:array<DnFingerprint>;
fn dnRanked(c:vec3f)->f32{
 var v=c;
 var top=select(1u,0u,v.x>v.y);
 top=select(2u,top,v[top]>v.z);
 let a=v[top];v[top]=v.y;v.y=a;
 var low=select(1u,0u,v.x<=v.y);
 low=select(2u,low,v[low]<=v.z);
 let b=v[low];v[low]=v.z;v.z=b;
 return luminance(v);
}
fn dnMeanOf(at:vec2i)->vec4f{
 let radiance=textureLoad(dnRadiance,at,0);
 if((dn.flags&${DN_FLAG_SINGLE_CHANNEL}u)==0u){return radiance;}
 var mean=vec4f(0.0);
 if((dn.flags&${DN_FLAG_RANKED}u)!=0u){
  mean.x=dnRanked(radiance.rgb);
  mean.y=dnRanked(textureLoad(dnAlbedo,at,0).rgb);
 }else{
  mean.x=luminance(radiance.rgb);
  mean.y=luminance(textureLoad(dnAlbedo,at,0).rgb);
 }
 mean.z=length(textureLoad(dnNormal,at,0).rgb);
 if(mean.z==0.0||dn.iteration==0u){mean.z=1.0;}
 mean.w=radiance.a;
 return mean;
}
@compute @workgroup_size(8,8,1)
fn ${DN_PREPASS_ENTRIES.prepass}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=dn.size)){return;}
 let index=id.x+id.y*dn.size.x;
 let mean=dnMeanOf(vec2i(id.xy));
 if(dn.iteration==0u){
  dnVarianceMap[index]=DnFingerprint(mean,vec4f(0.0));
  return;
 }
 var info=dnVarianceMap[index];
 let before=info.mean;
 let now=(mean-before)*f32(dn.iteration)+mean;
 info.mean=mean;
 info.spread+=(now-mean)*(now-before);
 dnVarianceMap[index]=info;
}`

const TEXTURE_WGSL = `${FINGERPRINT}
@group(0) @binding(1) var<storage,read> dnVarianceIn:array<DnFingerprint>;
@group(0) @binding(2) var dnVarianceOut:texture_storage_2d<rgba32float,write>;
@compute @workgroup_size(8,8,1)
fn ${DN_PREPASS_ENTRIES.texture}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=dn.size)){return;}
 let info=dnVarianceIn[id.x+id.y*dn.size.x];
 textureStore(dnVarianceOut,vec2i(id.xy),sqrt(max(info.spread,vec4f(0.0)))/f32(dn.iteration+1u));
}`

/**
 * THE DENOISER'S PREPASS: each pixel's running mean and sum of squared deviations (Welford's update, the sample `iteration` of the run), of the radiance's four channels or, in the
 * single-channel type, the luminance of the radiance, the luminance of the albedo, the length of the mean normal (1 where there is none, and at the first sample) and the alpha. The first
 * sample starts the pixel over. `dnVarianceTexture` turns the sums into the standard error of the mean, sqrt(sum) over the samples.
 */
export const DN_PREPASS_PROGRAMS = {
  prepass: wgslProgram(PREPASS_WGSL, [DN_PARAMS_WGSL, luminance]),
  texture: wgslProgram(TEXTURE_WGSL, [DN_PARAMS_WGSL]),
} as const
