import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { VECTOR_CODEC_WGSL } from '../../../post/taa/velocityWgsl.ts'
import { SCREEN_SPACE_BINDINGS as B } from '../rayCastWgsl.ts'
import { SCREEN_SPACE_GROUP_SIDE } from '../screenSpaceQuality.ts'
import { SCREEN_SPACE_GROUP } from '../screenSpaceView.ts'
import { DENOISE_BINDINGS as D } from './denoiseView.ts'
import { LOBE_ON_SCREEN_WGSL } from './spatialWgsl.ts'
import {
  DENOISE_COMMON_WGSL,
  DENOISE_LOAD_WGSL,
  denoiseSignalWgsl,
  type DenoiseSignal,
} from './signalWgsl.ts'

const G = SCREEN_SPACE_GROUP

/** The weight a history is capped at for the indirect light, the signal's own (the reflections' is their lobe's area, between 1 and 1024). */
const INDIRECT_TARGET_SAMPLES = 128
const REFLECTION_MAX_TARGET_SAMPLES = 1024

/** The weight the history is capped at: the reflections' lobe area in pixels, the indirect light's own. */
const accumulationTarget = (reflections: boolean) =>
  reflections
    ? `let lobe=dnLobeOnScreen(origin,screen);
 let targeted=clamp(3.14159265*lobe.z*lobe.w*ssView.size.x*ssView.size.x,1.0,${REFLECTION_MAX_TARGET_SAMPLES}.0);`
    : `let targeted=${INDIRECT_TARGET_SAMPLES}.0;`

/** The taps that gather the history: the four texels around the place for the reflections, one of them drawn by the weights for the indirect light. */
const accumulationHistory = (reflections: boolean) =>
  reflections
    ? ` for(var i=0u;i<4u;i++){
   dnHistoryTap(origin,tl+offsets[i],weights[i],&acc);
  }`
    : ` var chosen=vec2i(0);
  var passed=0.0;
  let random=interleavedGradientNoise(center,dnParams.time.x);
  for(var i=0u;i<4u;i++){
   if(random>passed){chosen=offsets[i];}
   passed+=weights[i];
  }
  dnHistoryTap(origin,tl+chosen,1.0,&acc);`

/** The bindings of the history and of the outputs, and the read of the surface the last image kept. */
const accumulationBindingsText =
  () => `@group(${G}) @binding(${D.historyA}) var historyA:texture_2d<f32>;
@group(${G}) @binding(${D.historyB}) var historyB:texture_2d<f32>;
@group(${G}) @binding(${D.prevDepth}) var prevDepth:texture_2d<f32>;
@group(${G}) @binding(${D.prevNormals}) var prevNormals:texture_2d<f32>;
@group(${G}) @binding(${B.out}) var outA:texture_storage_2d<rgba16float,write>;
@group(${G}) @binding(${B.outSecond}) var outB:texture_storage_2d<rg32float,write>;
/** The surface the last image kept at a texture coordinate of that image: its point (back in this image's world), depth, normal and roughness. */
fn dnMetaPrev(uv:vec2f)->DnMeta{
 let size=vec2i(textureDimensions(prevDepth));
 let pixel=clamp(vec2i(floor(uv*vec2f(size))),vec2i(0),size-vec2i(1));
 let z=max(textureLoad(prevDepth,pixel,0).r,1e-8);
 let normal=textureLoad(prevNormals,pixel,0);
 let clip=ssView.prevClipToWorld*vec4f(uv*vec2f(2.0,-2.0)+vec2f(-1.0,1.0),z,1.0);
 return DnMeta(clip.xyz/clip.w,ssSceneDepth(z),normalize(normal.xyz),normal.a);
}
`

/** The taps of the history and of the clamp's neighbourhood, and the helpers of the signal, under the bilateral `mode`. */
const accumulationTapsText = (
  mode: string,
  rejectMultiplier: string,
) => `fn dnHistoryTap(origin:DnMeta,texel:vec2i,weight:f32,acc:ptr<function,DnAcc>){
 let size=dnGridSize();
 if(any(texel<vec2i(0))||any(texel>=size)){return;}
 let loaded=dnDecodeHistory(textureLoad(historyA,texel,0),textureLoad(historyB,texel,0),false);
 if(loaded.s.n==0.0){return;}
 let near=dnMetaPrev((vec2f(texel)+vec2f(0.5))/vec2f(size));
 let dist=dnAmend(min(dnPixelRadius(near),dnPixelRadius(origin)))*3.0;
 dnAccAdd(acc,loaded.s,loaded.conf,weight*dnBilateral(${mode},dist,origin,near));
}
fn dnRejectTap(origin:DnMeta,pos:vec2f,force:bool,acc:ptr<function,DnAcc>){
 if(dnOutside(pos)){return;}
 let loaded=dnLoadSourceNormalized(dnTexelOf(pos));
 if(loaded.s.n==0.0){return;}
 var w=1.0;
 if(!force){w=dnBilateral(${mode},dnAmend(dnPixelRadius(origin))*${rejectMultiplier},origin,dnMetaCur(pos));}
 dnAccAdd(acc,dnToReject(loaded.s),loaded.conf,w);
}
fn dnStd(m1:DnSig,m2:DnSig)->DnSig{
 return DnSig(sqrt(abs(m2.n-m1.n*m1.n)),sqrt(abs(m2.c-m1.c*m1.c)),sqrt(abs(m2.m-m1.m*m1.m)));
}
fn dnClamp(s:DnSig,low:DnSig,high:DnSig)->DnSig{
 return DnSig(clamp(s.n,low.n,high.n),clamp(s.c,low.c,high.c),clamp(s.m,low.m,high.m));
}
`

/** The kernel: where the texel stood, the history clamped to the neighbourhood, the blend; `history` gathers the taps, `target` is the targeted weight. */
const accumulationKernelText = (
  history: string,
  target: string,
) => `@compute @workgroup_size(${SCREEN_SPACE_GROUP_SIDE},${SCREEN_SPACE_GROUP_SIDE})
fn denoiseCompute(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=vec2u(dnParams.grid.xy))){return;}
 let ratio=dnParams.grid.z;
 let shift=0.5/ratio;
 let center=vec2f(id.xy)+vec2f(shift);
 let full=center*ratio;
 let pixel=clampToExtent(vec2i(floor(full)),vec2i(ssView.size.xy));
 let screen=ssScreenOfPixel(full);
 let origin=dnMetaCur(center);
 let incoming=dnLoadSource(vec2i(id.xy));
 let current=incoming.s;
 var confusion=incoming.conf;
 // Where the texel stood in the last image.
 let prevClip=ssView.clipToPrevClip*vec4f(screen,hizOpaqueDepth(pixel),1.0);
 var back=screen-prevClip.xy/prevClip.w;
 let words=textureLoad(colorVectors,clampToExtent(pixel,vec2i(textureDimensions(colorVectors))),0);
 if(hasOwnMotion(words.r)){back=decodeVector(words.r);}
 let historyUV=(screen-back)*vec2f(0.5,-0.5)+vec2f(0.5);
 let edge=vec2f(0.5)/ssView.size.xy;
 var history=DnSig(0.0,vec4f(0.0),0.0);
 if(all(historyUV>=edge)&&all(historyUV<=vec2f(1.0)-edge)&&dnParams.grid.w==0.0){
  let at=historyUV*vec2f(dnParams.grid.xy)+vec2f(0.5-shift)-vec2f(0.5);
  let tl=vec2i(floor(at));
  let f=at-floor(at);
  var offsets=array<vec2i,4>(vec2i(0,0),vec2i(1,0),vec2i(0,1),vec2i(1,1));
  var weights=array<f32,4>((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y);
  var acc=dnAccNew();
${history}
  history=acc.s;
 }
 // The history clamped to the neighbourhood of the texel in this image.
 var nearby=dnAccNew();
 let unit=dnNormalized(current);
 if(unit.n!=0.0){dnAccAdd(&nearby,dnToReject(unit),confusion,1.0);}
 let force=current.n==0.0;
 dnRejectTap(origin,center+vec2f(1.0,0.0),force,&nearby);
 dnRejectTap(origin,center+vec2f(-1.0,0.0),force,&nearby);
 dnRejectTap(origin,center+vec2f(0.0,1.0),force,&nearby);
 dnRejectTap(origin,center+vec2f(0.0,-1.0),force,&nearby);
 let norm=safeRcp(nearby.s.n);
 let m1=dnMul(nearby.s,norm);
 let m2=dnMul(nearby.s2,norm);
 let deviation=dnStd(m1,m2);
 let low=DnSig(m1.n-1.25*deviation.n,m1.c-1.25*deviation.c,m1.m-1.25*deviation.m);
 let high=DnSig(m1.n+1.25*deviation.n,m1.c+1.25*deviation.c,m1.m+1.25*deviation.m);
 let held=dnToReject(dnNormalized(history));
 let clamped=dnClamp(held,low,high);
 var weight=history.n*saturate(1.0-dnRejection(clamped,held));
 weight=max(weight,m1.n*0.1);
 var kept=dnMul(dnFromReject(clamped),weight);
 kept.n=weight;
 confusion=min(confusion,nearby.conf);
 // The blend.
 ${target}
 let room=max(min(kept.n,targeted-current.n),0.0);
 let result=dnAdd(dnMul(kept,select(0.0,room/kept.n,kept.n>0.0)),current);
 textureStore(outA,vec2i(id.xy),dnEncodeA(result));
 textureStore(outB,vec2i(id.xy),dnEncodeB(result,confusion));
}`

/**
 * THE ACCUMULATION IN TIME (`denoiseCompute`, a thread a texel of the grid): the pass's input (the spatial pass's result) is blended with the history, the last
 * accumulated image, found where each texel stood.
 *  - Where it stood: the texel's surface point projected into the last image by the camera's motion, or by the surface's own vector where it moves by itself; a
 *    texel whose place is off the view, or an image with no history (`grid.w`), has none.
 *  - The history is read at that place, the four texels around it for the reflections, bilinear, one of them drawn by the weights for the indirect light, each
 *    weighted by its likeness to the texel's surface in the last image (the metadata kept then).
 *  - The history is clamped to the mean of the texel and its four neighbours, plus or minus 1.25 standard deviations, in luma-chroma for the reflections; the
 *    weight it loses to the clamp (the luma's change in stops, the chroma's and the alpha's for the reflections, the missed share's for the indirect light) is taken
 *    from it, and a neighbourhood that holds a sample gives it a tenth of a sample at least.
 *  - The history keeps what the targeted weight (the lobe's area in pixels for the reflections, 128 for the indirect light) allows less the input's; the sum is the result.
 */
const accumulationProgramText = (signal: DenoiseSignal) => {
  const reflections = signal === 'reflections'
  // The bilateral presets of the history and of the clamp, the reflections' (position by the distance, the lobes' likeness) and the indirect light's (the plane, the normals).
  const mode = reflections ? '1u,false,true' : '2u,true,false'
  const rejectMultiplier = reflections ? '1.0' : '3.0'
  return (
    accumulationBindingsText() +
    accumulationTapsText(mode, rejectMultiplier) +
    accumulationKernelText(accumulationHistory(reflections), accumulationTarget(reflections))
  )
}

/** The accumulation in time of `signal`, its input read as a denoising pass wrote it. */
export const denoiseAccumulationWgsl = (signal: DenoiseSignal) =>
  wgslProgram(accumulationProgramText(signal), [
    DENOISE_COMMON_WGSL,
    denoiseSignalWgsl(signal),
    DENOISE_LOAD_WGSL('history'),
    VECTOR_CODEC_WGSL,
    interleavedGradientNoise,
    ...(signal === 'reflections' ? [LOBE_ON_SCREEN_WGSL] : []),
  ])
