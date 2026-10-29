import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { fastAcos, fastAtan } from '../../../../../math/src/wgsl/geometry.ts'
import { luminance } from '../../../../../math/src/wgsl/color.ts'
import { makeFinite, makeFinite3 } from '../../../../../math/src/wgsl/integer.ts'
import { ndcToPixel } from '../../../../../math/src/wgsl/projection.ts'
import { interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import {
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { ACCUMULATION_WGSL } from '../../../post/taa/accumulationWgsl.ts'
import { YCOCG_WGSL } from '../../../post/taa/ycocgWgsl.ts'
import { WORLD_AT_WGSL } from '../../deferred/worldAtWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from '../constantsWgsl.ts'
import { REFLECTION_DISC_WGSL } from '../resolveWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from '../texelWgsl.ts'
import {
  REFLECTION_GROUP,
  REFLECTION_LINEAR_DEPTH_WGSL,
  reflectionBindingsWgsl,
  reflectionFrontWgsl,
  reflectionLightViewWgsl,
} from '../viewLayout.ts'
import { RTT_PARAMS_DECLARATION, RTT_TRACE_BINDINGS } from './traceWgsl.ts'

/** The formats of the resolved radiance (its alpha the path's length, below zero where no transparent surface covers the pixel), of the history (the radiance, the images it averages), of
 *  the history's past (the front layer's linear depth, the second moment of the luminance) and of the radiance and the throughput composed onto the image. */
export const RTT_RESOLVED_FORMAT: GPUTextureFormat = 'rgba16float'
export const RTT_HISTORY_FORMAT: GPUTextureFormat = 'rgba32float'
export const RTT_PAST_FORMAT: GPUTextureFormat = 'rg32float'
export const RTT_FINAL_FORMAT: GPUTextureFormat = 'rgba16float'

/** The bindings of the three denoising passes' group 0, one scheme for all: the parameters, the trace's three textures, the resolved radiance, the history and its past read, the front layer's normals, then the textures written. */
export const RTT_DENOISE_BINDINGS = {
  params: RTT_TRACE_BINDINGS.params,
  radiance: RTT_TRACE_BINDINGS.radiance,
  throughput: RTT_TRACE_BINDINGS.throughput,
  background: RTT_TRACE_BINDINGS.background,
  resolved: 5,
  history: 6,
  past: 7,
  normals: 8,
  historyOut: 9,
  pastOut: 10,
  finalRadiance: 11,
  finalThroughput: 12,
} as const
const D = RTT_DENOISE_BINDINGS

/** The passes in their order: the resolve of the trace, the temporal accumulation, the spatial filter. */
export const RTT_RESOLVE_ENTRY = 'tracedTranslucencyResolve'
export const RTT_TEMPORAL_ENTRY = 'tracedTranslucencyTemporal'
export const RTT_SPATIAL_ENTRY = 'tracedTranslucencySpatial'

const sampled = (binding: number) => computeTextureEntry(binding, 'unfilterable-float')
const written = (binding: number, format: GPUTextureFormat) =>
  computeStorageTextureEntry(binding, format)

/** The layout of group 0 of each pass: the resolve reads the trace and writes the resolved radiance and the final throughput; the temporal pass reads the resolved radiance, the history, its past and the front normals and
 *  writes the history and its past; the spatial pass reads the history, its past and the normals and writes the final radiance. No pass holds more than two storage textures. */
export const RTT_PASS_ENTRIES = {
  [RTT_RESOLVE_ENTRY]: () => [
    computeUniformEntry(D.params),
    sampled(D.radiance),
    sampled(D.throughput),
    sampled(D.background),
    written(D.resolved, RTT_RESOLVED_FORMAT),
    written(D.finalThroughput, RTT_FINAL_FORMAT),
  ],
  [RTT_TEMPORAL_ENTRY]: () => [
    computeUniformEntry(D.params),
    sampled(D.resolved),
    sampled(D.history),
    sampled(D.past),
    sampled(D.normals),
    written(D.historyOut, RTT_HISTORY_FORMAT),
    written(D.pastOut, RTT_PAST_FORMAT),
  ],
  [RTT_SPATIAL_ENTRY]: () => [
    computeUniformEntry(D.params),
    sampled(D.history),
    sampled(D.past),
    sampled(D.normals),
    written(D.finalRadiance, RTT_FINAL_FORMAT),
  ],
} as const

/** A pixel the front layer covers: its depth is not the opaque one's. */
const COVERED = `fn rttCovered(cell:vec2i)->bool{return reflectionFrontDepth(cell)!=hizOpaqueDepth(cell);}`

const RESOLVE_TEXT = `@group(0) @binding(${D.radiance}) var rttRadiance:texture_2d<f32>;
@group(0) @binding(${D.throughput}) var rttThroughput:texture_2d<f32>;
@group(0) @binding(${D.background}) var rttBackground:texture_2d<f32>;
@group(0) @binding(${D.resolved}) var rttResolved:texture_storage_2d<${RTT_RESOLVED_FORMAT},write>;
@group(0) @binding(${D.finalThroughput}) var rttFinalThroughput:texture_storage_2d<${RTT_FINAL_FORMAT},write>;
${COVERED}
/** What a trace texel stands for, resolved: the radiance and the path's length, the throughput, the background shares. */
struct RttTexel{radiance:vec4f,throughput:vec3f,background:vec2f,}
fn rttTexelAt(t:vec2i)->RttTexel{
 return RttTexel(textureLoad(rttRadiance,t,0),textureLoad(rttThroughput,t,0).rgb,textureLoad(rttBackground,t,0).rg);
}
/** The pixel a trace texel stood for this image. */
fn rttPickedPixel(t:vec2i)->vec2i{
 let block=rtt.size.z;
 var pixel=vec2u(t)*block+vec2u(rtt.size.w%block,(rtt.size.w/block)%block);
 return vec2i(min(pixel,vec2u(view.viewport.xy)-vec2u(1u)));
}
/** The resolve (the reconstruction of a downsampled trace): a block of one pixel reads its texel; a larger one blends the bilinear neighbours the pixel lies between, each weighed by how near its front depth is to the pixel's, a texel whose pixel no transparent surface covers left out. */
fn rttResolve(pixel:vec2i,frontZ:f32)->RttTexel{
 let block=i32(rtt.size.z);
 let last=vec2i(rtt.size.xy)-vec2i(1);
 let at=(vec2f(pixel)+vec2f(0.5))/f32(block)-vec2f(0.5);
 let base=vec2i(floor(at));
 let f=at-floor(at);
 let centre=reflectionLinearOfDevice(frontZ);
 var sum=RttTexel(vec4f(0.0),vec3f(0.0),vec2f(0.0));
 var total=0.0;
 for(var k=0;k<4;k++){
  let o=vec2i(k&1,k>>1);
  let t=clamp(base+o,vec2i(0),last);
  let picked=rttPickedPixel(t);
  if(!rttCovered(picked)){continue;}
  let texel=rttTexelAt(t);
  let w=mix(1.0-f.x,f.x,f32(o.x))*mix(1.0-f.y,f.y,f32(o.y))*exp(-abs(reflectionLinearOfDevice(reflectionFrontDepth(picked))-centre)/max(centre*0.01,1.0e-4));
  sum.radiance+=w*texel.radiance;
  sum.throughput+=w*texel.throughput;
  sum.background+=w*texel.background;
  total+=w;
 }
 if(total<1.0e-6){return rttTexelAt(clamp(vec2i(round(at)),vec2i(0),last));}
 let inv=1.0/total;
 return RttTexel(sum.radiance*inv,sum.throughput*inv,sum.background*inv);
}
@compute @workgroup_size(8,8,1)
fn ${RTT_RESOLVE_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=view.viewport.xy)){return;}
 let pixel=vec2i(id.xy);
 if(!rttCovered(pixel)){
  textureStore(rttResolved,pixel,vec4f(0.0,0.0,0.0,-1.0));
  textureStore(rttFinalThroughput,pixel,vec4f(1.0));
  return;
 }
 let texel=rttResolve(pixel,reflectionFrontDepth(pixel));
 textureStore(rttResolved,pixel,texel.radiance);
 // The background the surfaces let show, as the reference finalizes it: the share the path leaves visible times what the image behind holds, which the composition lays on the image's alpha.
 textureStore(rttFinalThroughput,pixel,vec4f(texel.throughput,select(texel.background.y,1.0,texel.background.y<=0.0&&texel.background.x<=0.0)));
}`

const TEMPORAL_TEXT = `@group(0) @binding(${D.resolved}) var rttResolved:texture_2d<f32>;
@group(0) @binding(${D.history}) var rttHistory:texture_2d<f32>;
@group(0) @binding(${D.past}) var rttPast:texture_2d<f32>;
@group(0) @binding(${D.normals}) var rttNormals:texture_2d<f32>;
@group(0) @binding(${D.historyOut}) var rttHistoryOut:texture_storage_2d<${RTT_HISTORY_FORMAT},write>;
@group(0) @binding(${D.pastOut}) var rttPastOut:texture_storage_2d<${RTT_PAST_FORMAT},write>;
/** A history: its radiance in the denoiser's space, its luminance's second moment there, the images it averages, whether it holds. */
struct RttHistory{radiance:vec3f,moment:f32,count:f32,valid:bool,}
/** The history of the point the last image saw at point: the four texels the point lies between, the bilinear weights; surface, whether the point is the pixel's own, of normal N seen from V, whose texels are kept as their front depth agrees with
 *  the depth the point is expected at (within the history's distance threshold, from half to one and a half by noise, raised at grazing angles) — a hit's point has no such test. */
fn rttHistoryOf(point:vec3f,surface:bool,N:vec3f,V:vec3f,noise:f32)->RttHistory{
 var held=RttHistory(vec3f(0.0),0.0,0.0,false);
 if(rtt.history.z==0.0){return held;}
 let clip=reflectionView.radianceViewProj*vec4f(point,1.0);
 if(clip.w<=0.0){return held;}
 let size=view.viewport.xy;
 let screen=ndcToPixel(clip.xy/clip.w-reflectionView.jitter.zw+reflectionView.jitter.xy,size);
 if(any(screen<vec2f(0.0))||any(screen>size)){return held;}
 let at=clamp(screen,vec2f(0.51),size-vec2f(0.51))-vec2f(0.5);
 let corner=vec2i(floor(at));
 let f=at-floor(at);
 let depth=reflectionLinearDepth(clip);
 var threshold=reflectionView.denoise.z*mix(0.5,1.5,noise);
 if(surface){threshold/=clamp(dot(V,N),0.1,1.0);}
 var sum=vec3f(0.0);
 var moment=0.0;
 var weights=0.0;
 var count=0.0;
 var kept=false;
 for(var k=0u;k<4u;k++){
  let o=vec2u(k&1u,k>>1u);
  let t=corner+vec2i(o);
  let past=textureLoad(rttPast,t,0).rg;
  if(!(past.x>0.0)){continue;}
  if(surface&&abs(past.x-depth)>=depth*threshold){continue;}
  let h=textureLoad(rttHistory,t,0);
  let w=mix(1.0-f.x,f.x,f32(o.x))*mix(1.0-f.y,f.y,f32(o.y));
  kept=kept||w>0.01;
  sum+=w*reflectionDenoised(h.rgb);
  moment+=w*past.y;
  count+=w*h.a;
  weights+=w;
 }
 if(!kept){return held;}
 return RttHistory(sum/weights,moment/weights,count/weights,true);
}
/** The mean of the resolved neighbours of the pixel (a 5 x 5 window less its corners), with the centre centre (YCoCg), and the extent the history is clamped to: the clamp's scale times their standard deviation. */
struct RttWindow{centre:vec3f,extent:vec3f,}
fn rttWindow(pixel:vec2i,centre:vec3f)->RttWindow{
 let last=vec2i(view.viewport.xy)-vec2i(1);
 var sum=centre;
 var square=centre*centre;
 var n=1.0;
 for(var k=0;k<25;k++){
  let o=vec2i(k%5-2,k/5-2);
  if((abs(o.x)==2&&abs(o.y)==2)||all(o==vec2i(0))){continue;}
  let at=pixel+o;
  if(any(at<vec2i(0))||any(at>last)){continue;}
  let r=textureLoad(rttResolved,at,0);
  if(r.a<0.0){continue;}
  let v=toYcocg(reflectionDenoised(r.rgb));
  sum+=v;
  square+=v*v;
  n+=1.0;
 }
 let m=sum/n;
 return RttWindow(m,reflectionView.denoise.y*sqrt(max(square/n-m*m,vec3f(0.0))));
}
@compute @workgroup_size(8,8,1)
fn ${RTT_TEMPORAL_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=view.viewport.xy)){return;}
 let pixel=vec2i(id.xy);
 let resolved=textureLoad(rttResolved,pixel,0);
 if(resolved.a<0.0){
  textureStore(rttHistoryOut,pixel,vec4f(0.0));
  textureStore(rttPastOut,pixel,vec4f(0.0));
  return;
 }
 // The temporal accumulation, in the denoiser's space: the history is read at the front layer's own point and, for a narrow lobe, where the light came from (the path's length along the ray from the eye).
 let eye=view.display.yzw;
 let frontZ=reflectionFrontDepth(pixel);
 let P=worldAt(vec2f(pixel)+vec2f(0.5),frontZ);
 let V=normalize(eye-P);
 let normal=textureLoad(rttNormals,pixel,0);
 let N=normalize(normal.xyz);
 let rough=normal.a;
 var lighting=reflectionDenoised(resolved.rgb);
 var moment=luminance(lighting)*luminance(lighting);
 var count=0.0;
 if(rtt.history.z!=0.0&&reflectionDone(REFLECTION_TEMPORAL)){
  let noise=interleavedGradientNoise(vec2f(pixel),f32(reflectionView.temporal.y));
  var fromHit=RttHistory(vec3f(0.0),0.0,0.0,false);
  let s=saturate(1.0-rough);
  if(s*(sqrt(s)+rough)>0.5){
   fromHit=rttHistoryOf(select(P,eye-V*resolved.a,resolved.a>0.0),false,N,V,noise);
  }
  let fromSurface=rttHistoryOf(P,true,N,V,noise);
  if(fromSurface.valid||fromHit.valid){
   let block=rtt.size.z;
   let reconstructed=block>1u&&any(vec2u(pixel)%block!=vec2u(rtt.size.w%block,(rtt.size.w/block)%block));
   let window=rttWindow(pixel,toYcocg(lighting));
   let hitY=toYcocg(fromHit.radiance);
   let surfaceY=toYcocg(fromSurface.radiance);
   var alpha=0.0;
   if(length(window.centre-hitY)>length(window.centre-surfaceY)+0.01/max(view.preExposure.x,REFLECTION_EPSILON)){alpha=0.8;}
   alpha=select(1.0,alpha,fromHit.valid);
   let history=mix(hitY,surfaceY,alpha);
   let extent=window.extent*select(1.0,2.0,reconstructed);
   let lo=window.centre-extent;
   let hi=window.centre+extent;
   let clamped=mix(clamp(hitY,lo,hi),clamp(surfaceY,lo,hi),alpha);
   let least=vec3f(REFLECTION_CLAMP_FLOOR/max(view.preExposure.x,REFLECTION_EPSILON));
   let trust=0.75*saturate(1.0-length(abs(clamped-history)/max(extent,least)))+0.25;
   let held=select(fromHit.count,fromSurface.count,alpha>0.5);
   // A full-resolution mirror leans on the temporal anti-aliasing for the rest of its noise.
   var most=reflectionView.denoise.x;
   if(block==1u){most=reflectionMaxFrames(most,rough);}
   count=accumulationCount(held*trust,1.0,most);
   let fresh=1.0/(count+select(0.0,4.0,reconstructed));
   moment=mix(mix(fromHit.moment,fromSurface.moment,alpha),moment,fresh);
   lighting=mix(fromYcocg(clamped),lighting,fresh);
  }
 }
 // Neither an infinity nor a NaN reaches the history: the radiance and its moment are made finite, then held above zero.
 textureStore(rttHistoryOut,pixel,vec4f(reflectionLinear(max(makeFinite3(lighting),vec3f(0.0))),count));
 textureStore(rttPastOut,pixel,vec4f(reflectionLinearOfDevice(frontZ),max(makeFinite(moment),0.0),0.0,0.0));
}`

const SPATIAL_TEXT = `@group(0) @binding(${D.history}) var rttHistory:texture_2d<f32>;
@group(0) @binding(${D.past}) var rttPast:texture_2d<f32>;
@group(0) @binding(${D.normals}) var rttNormals:texture_2d<f32>;
@group(0) @binding(${D.finalRadiance}) var rttFinalRadiance:texture_storage_2d<${RTT_FINAL_FORMAT},write>;
/** A radiance of the denoiser's space tonemapped by the disocclusion heavy, c / (1 + heavy L(c)), which keeps one firefly of a pixel new to the screen from lighting its neighbours; rttUntonemap turns it back. */
fn rttTonemap(c:vec3f,heavy:f32)->vec3f{return c/(1.0+heavy*luminance(c));}
fn rttUntonemap(c:vec3f,heavy:f32)->vec3f{return c/(1.0-heavy*luminance(c));}
/** The spatial filter, after the temporal accumulation: a pixel whose history is short (its disocclusion, one minus its images over the disocclusion frames) or noisy (the standard deviation of its luminance the second moment gives, past half
 *  its luminance) takes the mean of a disc of neighbours, each weighed by its depth against the pixel's plane, its normal against the pixel's lobe, and its luminance against the pixel's spread; a converged, quiet pixel keeps its own. */
@compute @workgroup_size(8,8,1)
fn ${RTT_SPATIAL_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=view.viewport.xy)){return;}
 let pixel=vec2i(id.xy);
 let past=textureLoad(rttPast,pixel,0).rg;
 if(!(past.x>0.0)){
  textureStore(rttFinalRadiance,pixel,vec4f(0.0));
  return;
 }
 let held=textureLoad(rttHistory,pixel,0);
 let normal=textureLoad(rttNormals,pixel,0);
 let N=normalize(normal.xyz);
 let rough=normal.a;
 var disocclusion=0.0;
 if(u32(reflectionMaxFrames(reflectionView.denoise.x,rough))>1u&&reflectionView.spread.w>0.0){
  disocclusion=1.0-saturate(held.a/reflectionView.spread.w);
 }
 let radius=reflectionView.spread.y*saturate(rough*8.0);
 let mine=reflectionDenoised(held.rgb);
 let lum=luminance(mine);
 let deviation=sqrt(max(past.y-lum*lum,0.0));
 let noisy=deviation/max(lum,0.1)>0.5;
 var result=held.rgb;
 if(reflectionDone(REFLECTION_BILATERAL)&&(noisy||disocclusion>0.01)&&radius>1.0){
  let taps=u32(mix(f32(reflectionView.taps.y),f32(2u*reflectionView.taps.y),disocclusion)+0.5);
  // The lobe's half angle, a normal weighs nothing past it: widened four times as the disocclusion grows.
  let halfAngle=clamp((fastAtan(3.0*rough*rough)+0.01)*mix(1.0,4.0,disocclusion),0.01,0.5*PI);
  let size=vec2i(view.viewport.xy);
  let P=worldAt(vec2f(pixel)+vec2f(0.5),reflectionFrontDepth(pixel));
  let depth=reflectionLinearOfDevice(reflectionFrontDepth(pixel));
  let seed=reflectionReuseSeed(pixel%vec2i(2));
  var sum=rttTonemap(mine,disocclusion);
  var total=1.0;
  for(var k=0u;k<taps;k++){
   let tap=vec2i(vec2f(pixel)+radius*reflectionReuseTap(k,taps,seed)+vec2f(0.5));
   if(any(tap<vec2i(0))||any(tap>=size)){continue;}
   let theirPast=textureLoad(rttPast,tap,0).rg;
   if(!(theirPast.x>0.0)){continue;}
   let off=abs(dot(worldAt(vec2f(tap)+vec2f(0.5),reflectionFrontDepth(tap))-P,N))/depth;
   let level=exp2(-reflectionView.reach.w*off*off);
   let angle=fastAcos(saturate(dot(N,normalize(textureLoad(rttNormals,tap,0).xyz))));
   let across=1.0-saturate(angle/halfAngle);
   let theirs=reflectionDenoised(textureLoad(rttHistory,tap,0).rgb);
   let near=mix(exp2(-abs(lum-luminance(theirs))/max(deviation,0.001)),1.0,disocclusion);
   let w=level*across*near;
   sum+=w*rttTonemap(theirs,disocclusion);
   total+=w;
  }
  result=reflectionLinear(rttUntonemap(sum/total,disocclusion));
 }
 textureStore(rttFinalRadiance,pixel,vec4f(result,0.0));
}`

const SHARED = [
  reflectionBindingsWgsl(REFLECTION_GROUP),
  reflectionFrontWgsl(REFLECTION_GROUP),
  reflectionLightViewWgsl(REFLECTION_GROUP),
  REFLECTION_LINEAR_DEPTH_WGSL,
  WORLD_AT_WGSL,
]
const TEMPORAL_BLOCKS = [
  REFLECTION_CONSTANTS_WGSL,
  REFLECTION_TEXEL_WGSL,
  ACCUMULATION_WGSL,
  YCOCG_WGSL,
  ndcToPixel,
  interleavedGradientNoise,
  makeFinite,
  makeFinite3,
  luminance,
]

/**
 * THE TRACED TRANSLUCENCY'S DENOISING, three passes a thread a pixel of the image. Where no transparent surface covers a pixel nothing is composed (radiance zero, throughput one).
 * `tracedTranslucencyResolve` reconstructs the trace's texels (the texel itself at a block of one pixel, the bilinear neighbours weighed by depth at a larger one) and finalizes the throughput and the
 * background left visible. `tracedTranslucencyTemporal` accumulates the radiance, in the denoiser's space, with the history read at the front layer's own point (its texels kept as their depth agrees) and, for a narrow
 * lobe, at the point the light came from, clamped to the neighbourhood of the resolved pixels and trusted by how far the clamp moved it. `tracedTranslucencySpatial` filters, after it, the pixels whose history is short or noisy,
 * and writes the radiance the composition lays over the image. The group 1 is the reflection group (the view, the depth pyramid, the front depth).
 */
export const tracedTranslucencyDenoiseProgram = (entry: keyof typeof RTT_PASS_ENTRIES) => {
  const text = {
    [RTT_RESOLVE_ENTRY]: RESOLVE_TEXT,
    [RTT_TEMPORAL_ENTRY]: TEMPORAL_TEXT,
    [RTT_SPATIAL_ENTRY]: SPATIAL_TEXT,
  }[entry]
  const blocks =
    entry === RTT_RESOLVE_ENTRY
      ? SHARED
      : entry === RTT_TEMPORAL_ENTRY
        ? [...SHARED, ...TEMPORAL_BLOCKS]
        : [...SHARED, ...TEMPORAL_BLOCKS, REFLECTION_DISC_WGSL, PI, fastAcos, fastAtan]
  return wgslProgram(`${RTT_PARAMS_DECLARATION}\n${text}`, blocks)
}
