import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { SURFACE_MODEL_MASK, UNLIT_FLAG } from '../../../materials/surface/surfaceModelWord.ts'
import { SCREEN_SPACE_GROUP_SIDE } from '../../screenSpaceTracing/screenSpaceQuality.ts'
import { OCCLUSION_DENOISE_COMMON_WGSL } from './shadowDenoiseCommonWgsl.ts'
import { OCCLUSION_TARGETED_SAMPLES, OUT_HISTORY } from './shadowDenoiseSpatialWgsl.ts'
import { historyWgsl } from './shadowDenoiseTemporalWgsl.ts'

const SIDE = SCREEN_SPACE_GROUP_SIDE

/** The most standard deviations of the neighbourhood the history may stray from its mean by, and the share of a sample a neighbourhood that holds one leaves the history at least. */
const DEVIATIONS = 6
const LEAST_HISTORY = 0.1

/**
 * THE INJESTION OF THE OCCLUSION (`occlusionInject`, a thread a pixel): the trace's occlusion (the source's red) and the distance of the nearest blocker its rays found (the second source's green, the
 * same texture) become a sample: one where rays were cast, with the occlusion as its share that arrived, and the distance as the radius it blurs by; none, with the radius `SD_RADIUS_INVALID`, where
 * none was (a distance below zero).
 */
export const occlusionInjestWgsl = () =>
  wgslProgram(
    `${OUT_HISTORY}
@compute @workgroup_size(${SIDE},${SIDE})
fn occlusionInject(@builtin(global_invocation_id) gid:vec3u){
 let id=vec3u(sdPixelOf(gid.xy),0u);
 if(any(id.xy>=vec2u(dnParams.rect.zw))){return;}
 let at=vec2i(id.xy);
 let hit=textureLoad(sourceB,at,0).y;
 if(hit<0.0){textureStore(outA,at,vec4f(0.0,0.0,SD_RADIUS_INVALID,0.0));return;}
 textureStore(outA,at,vec4f(textureLoad(sourceA,at,0).x,1.0,hit,0.0));
}`,
    [OCCLUSION_DENOISE_COMMON_WGSL],
  )

/**
 * THE REJECTION PRE-CONVOLUTION (`occlusionRejection`, a thread a pixel): the first and second moments of the share that arrived over the pixel and its four neighbours up, down, left and right, every
 * sample brought to one, each neighbour weighed by the history's weight (`sdHistoryWeight`) within the reach of the pixel's own radius and the pixel itself whole; written as the first moment's mean and weight
 * (red, green) and the second's (blue, alpha), which the accumulation in time bounds its history with.
 */
export const occlusionRejectionWgsl = () =>
  wgslProgram(
    `${OUT_HISTORY}
struct OcMoments{m1:vec2f,m2:vec2f,}
fn ocTake(acc:ptr<function,OcMoments>,pos:vec2f,light:SdLight,base:SdSurface,reach:f32,force:bool){
 if(sdOutside(pos)){return;}
 let texel=vec2i(floor(pos));
 let s=sdTap(texel);
 if(s.n==0.0){return;}
 var w=1.0;
 if(!force){
  let near=sdSurfaceAt(texel);
  w=sdHistoryWeight(light,min(sdAmend(ssPixelRadius(near.depth)),reach),base,near);
 }
 let share=s.m/s.n;
 (*acc).m1+=vec2f(1.0,share)*w;
 (*acc).m2+=vec2f(1.0,share*share)*w;
}
@compute @workgroup_size(${SIDE},${SIDE})
fn occlusionRejection(@builtin(global_invocation_id) gid:vec3u){
 let id=vec3u(sdPixelOf(gid.xy),0u);
 if(any(id.xy>=vec2u(dnParams.rect.zw))){return;}
 let at=vec2i(id.xy);
 let light=sdLight();
 let base=sdSurfaceAt(at);
 let reach=sdAmend(ssPixelRadius(base.depth));
 var acc=OcMoments(vec2f(0.0),vec2f(0.0));
 let centre=vec2f(id.xy)+vec2f(0.5);
 ocTake(&acc,centre,light,base,reach,true);
 ocTake(&acc,centre+vec2f(1.0,0.0),light,base,reach,false);
 ocTake(&acc,centre-vec2f(1.0,0.0),light,base,reach,false);
 ocTake(&acc,centre+vec2f(0.0,1.0),light,base,reach,false);
 ocTake(&acc,centre-vec2f(0.0,1.0),light,base,reach,false);
 let first=select(1.0,acc.m1.y/acc.m1.x,acc.m1.x>0.0);
 let second=select(1.0,acc.m2.y/acc.m2.x,acc.m2.x>0.0);
 textureStore(outA,at,vec4f(first,acc.m1.x,second,acc.m2.x));
}`,
    [OCCLUSION_DENOISE_COMMON_WGSL],
  )

/**
 * THE ACCUMULATION IN TIME OF THE OCCLUSION (`occlusionTemporal`, a thread a pixel): the pre-convolved sample of this image (the source, taken as one sample) blended with the history, the last image's result.
 *  - where the pixel stood, and the history gathered there, as the shadow's (`historyWgsl`), but the reference surface is the pixel's own placed where it stood (its point and depth in the last image, its
 *    normal), each tap weighed by the plane distance and the normals' agreement within three times the reach of the two pixels;
 *  - its rejection: the neighbourhood's moments (the second source, the rejection pre-convolution) taken over a rotated three by three (the offsets 2x - y, x + 2y), each weighed by the same weight within the
 *    reach of the pixel's own radius, bound the history's share to the mean plus or minus 6 deviations; the history keeps the weight it had less what the bounding moved the share by, and a tenth of a sample
 *    at least where the neighbourhood holds one; an unlit pixel keeps none;
 *  - the blend: the history is kept up to 256 samples (`OCCLUSION_TARGETED_SAMPLES`) less the sample's, the sum is the result, written with the radius of the pixel's sample.
 */
export const occlusionTemporalWgsl = () =>
  wgslProgram(
    `@compute @workgroup_size(${SIDE},${SIDE})
fn occlusionTemporal(@builtin(global_invocation_id) gid:vec3u){
 let id=vec3u(sdPixelOf(gid.xy),0u);
 if(any(id.xy>=vec2u(dnParams.rect.zw))){return;}
 let at=vec2i(id.xy);
 let light=sdLight();
 let base=sdSurfaceAt(at);
 let current=sdTap(at);
 let currentN=select(0.0,1.0,current.n>0.0);
 let currentShare=select(0.0,current.m/current.n,current.n>0.0);
 // Where the pixel stood in the last image, and the history there.
 let place=sdPlace(at);
 var history=vec2f(0.0);
 if(place.w>0.0){
  let clip=ssView.prevClipToWorld*vec4f(place.xy*vec2f(2.0,-2.0)+vec2f(-1.0,1.0),place.z,1.0);
  var stood=base;
  if(clip.w>1e-8){stood=SdSurface(clip.xyz/clip.w,ssSceneDepth(place.z),base.N,base.flags);}
  history=sdHistory(light,stood,place.xy);
 }
 // The neighbourhood's moments: the rejection pre-convolution over a rotated three by three.
 let reach=sdAmend(ssPixelRadius(base.depth));
 var first=vec2f(0.0);
 var second=vec2f(0.0);
 for(var k=0;k<9;k++){
  let x=k%3-1;
  let y=k/3-1;
  let pos=vec2f(at)+vec2f(0.5)+vec2f(f32(2*x-y),f32(x+2*y));
  if(sdOutside(pos)){continue;}
  let texel=vec2i(floor(pos));
  let v=textureLoad(sourceB,texel,0);
  var w=1.0;
  if(k!=4){w=sdHistoryWeight(light,reach,base,sdSurfaceAt(texel));}
  if(v.g!=0.0){first+=vec2f(v.g,v.g*v.r)*w;}
  if(v.a!=0.0){second+=vec2f(v.a,v.a*v.b)*w;}
 }
 let norm=safeRcp(first.x);
 let mean=first*norm;
 let deviation=sqrt(abs(second*norm-mean*mean));
 let low=mean-${DEVIATIONS}.0*deviation;
 let high=mean+${DEVIATIONS}.0*deviation;
 let held=select(0.0,history.y/history.x,history.x>0.0);
 let brought=clamp(vec2f(select(0.0,1.0,history.x>0.0),held),low,high);
 var weight=history.x*saturate(1.0-abs(brought.y-held));
 weight=max(weight,mean.x*${LEAST_HISTORY});
 if((base.flags&${SURFACE_MODEL_MASK}u)==${UNLIT_FLAG}u){weight=0.0;}
 // The blend.
 let kept=min(weight,${OCCLUSION_TARGETED_SAMPLES}.0-currentN);
 let scale=select(0.0,kept/weight,weight>0.0);
 textureStore(outA,at,sdEncode(weight*scale+currentN,brought.y*weight*scale+currentN*currentShare,current.r));
}`,
    [OCCLUSION_DENOISE_COMMON_WGSL, historyWgsl(true)],
  )

/** THE OUTPUT OF THE OCCLUSION (`occlusionFinal`, a thread a pixel): the share of the rays that arrived of the accumulated sample, 1 where it has none, into the red of the occlusion the lighting reads. */
export const occlusionFinalWgsl = () =>
  wgslProgram(
    `${OUT_HISTORY}
@compute @workgroup_size(${SIDE},${SIDE})
fn occlusionFinal(@builtin(global_invocation_id) gid:vec3u){
 let id=vec3u(sdPixelOf(gid.xy),0u);
 if(any(id.xy>=vec2u(dnParams.rect.zw))){return;}
 let at=vec2i(id.xy);
 let v=textureLoad(sourceA,at,0);
 textureStore(outA,at,vec4f(select(1.0,v.r,v.g>0.0),0.0,0.0,0.0));
}`,
    [OCCLUSION_DENOISE_COMMON_WGSL],
  )
