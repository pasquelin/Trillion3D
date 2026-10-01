import { FULLSCREEN_VERTEX } from '../lighting/deferred/shaders.ts';
import { taaReprojectWgsl } from '../taa/shaderWgsl.ts';
import { PAGE_INFO_STRUCT_WGSL } from '../visibility/shader/pageWgsl.ts';
import { REFLECTION_PHASE_WGSL } from './hizTraceWgsl.ts';

/** The weight a history stores at most: a bound on binary16 storage, never the window it keeps
 *  (`params.y`). At this scale binary16 has 1/32 weight spacing; RGB arithmetic remains binary32. */
const REFLECTION_HISTORY_WEIGHT = 64;
/** Frames a still history accumulates before the image may rest (#1346), and the frames of its own
 *  filtered weight it keeps at most: the reference's rough reflections average about this many
 *  reprojected frames behind a spatial filter. A declared class 2 on reflective pixels, bounded
 *  against `develop`'s converged still image. */
export const REFLECTION_STILL_FRAMES = 12;
/** The spatial filter's reach in pixels at roughness 0, twice it at roughness 1: a tent over the
 *  half-resolution texels traced around a pixel, kept on its receiver, lobe and plane. */
const REFLECTION_FILTER_RADIUS = 2;
/** A neighbour off the pixel's plane by more than this share of its distance is another surface. */
const REFLECTION_FILTER_PLANE = 0.1;
/** The frames of its own weight a history keeps while its sources or camera move at a pixel whose
 *  neighbourhood holds too few traced samples to clip it by (`REFLECTION_CLIP_SAMPLES`): a
 *  reflection there lags them by about this many frames. Everywhere else the history keeps its
 *  whole window, clipped (#831). */
const REFLECTION_MOVING_KEPT = 4;
/** While its sources or camera move, a history's mean is clipped to this image's neighbourhood —
 *  the traced texels around the pixel on its receiver, lobe and plane — at its mean plus or minus
 *  this many standard deviations, as Unreal's temporal filters clip theirs (#831): a reflection
 *  that changed leaves the box and follows at once, one that did not keeps its whole window and
 *  its noise averaged. Two deviations hold the converged mean of up to sixteen noisy samples. */
const REFLECTION_CLIP_SIGMAS = 2;
/** The traced weight a neighbourhood needs before its deviation is trusted to clip a history. */
const REFLECTION_CLIP_SAMPLES = 4;
/** The frames of its own weight a history keeps across a placement change it cannot follow (#33):
 *  a moved or newly resident source's stale share halves each frame, whatever weight W the filter
 *  gathers there (about 1 on a glossy receiver, more on a rough one), while a moving view, which
 *  changes probes every frame, still averages two samples rather than restarting from one, which
 *  flickers. */
export const REFLECTION_CHANGE_KEPT = 1;
/** Frames a changed source keeps `REFLECTION_CHANGE_KEPT`: the stale share falls to
 *  (1/2)^8 = 1/256 at any roughness, under a 1/255 step, and the still window after it dilutes it
 *  further: a held image keeps nothing of what a reflection showed before (#33), and the change
 *  plus the window close within 20 frames (#1346). */
export const REFLECTION_CHANGE_FRAMES = 8;
export const REFLECTION_RESOLVE_VIEW_BYTES = 176;

/** The depth the point drawn at `pixel` (depth `z`, identifier `id`) had on the last image, moved
 *  back by its placement's motion while `params.z` says it is live, and the one-pixel slope a
 *  stored depth may differ from it by. It is called before any non-uniform return: the slope is a
 *  derivative. A stored depth off it is another surface, the point was hidden (disocclusion): the
 *  history resolve and the reflection source (`sourceWgsl.ts`) reject by it. */
export const PREVIOUS_DEPTH_WGSL = `
fn clipAt(pixel:vec2f,z:f32)->vec4f{
 let ndc=vec2f(pixel.x*view.viewport.z*2.0-1.0,1.0-pixel.y*view.viewport.w*2.0);
 return view.invViewProj*vec4f(ndc,z,1.0);
}
fn previousDepthOf(pixel:vec2f,z:f32,id:u32)->vec2f{
 var position=clipAt(pixel,z);
 if(view.params.z!=0.0&&id!=0u){position=motion[placementOf(id)]*position;}
 let projected=view.prevViewProj*position;
 let expected=projected.z/projected.w;
 return vec2f(expected,max(abs(dpdx(expected))+abs(dpdy(expected)),1e-7));
}`;

/** Dedicated ratio-estimator resolve. It shares only reprojection mathematics
 * with TAA: no neighbourhood clamp, colour transform or TAA history is involved.
 * The trace ran at half resolution, each texel for one pixel of its 2 × 2 block
 * (`reflectionPhase`): a pixel takes the 4 × 4 texels around it whose pixel is on its
 * receiver, lobe and plane, each by a tent of its distance (`REFLECTION_FILTER_RADIUS`): the
 * reference's ray reuse and its bilateral spatial filter in one gather. History follows the
 * placement motion (`params.z`) and is dropped only where its receiver, normal
 * or depth disagree; `params.y` caps it in frames of this image's filtered weight (the still
 * window, or `REFLECTION_CHANGE_KEPT` after a change it cannot follow): the share a frame renews is
 * the same at every roughness. `params.w` is the trace seed's low bits. While its sources or camera
 * move (`clip.x`), the history's mean is clipped to the neighbourhood of this image's samples
 * (`REFLECTION_CLIP_SIGMAS`) instead of its window being shortened; still, nothing is clipped. */
export const REFLECTION_RESOLVE_WGSL = `
${FULLSCREEN_VERTEX}
${PAGE_INFO_STRUCT_WGSL}
struct ReflectionResolveView{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,clip:vec4f,}
@group(0) @binding(0) var sampleColor:texture_2d<f32>;
@group(0) @binding(1) var historyColor:texture_2d<f32>;
@group(0) @binding(2) var depth:texture_depth_2d;
@group(0) @binding(3) var normalRough:texture_2d<f32>;
@group(0) @binding(4) var ids:texture_2d<u32>;
@group(0) @binding(5) var previousDepth:texture_depth_2d;
@group(0) @binding(6) var previousNormal:texture_2d<f32>;
@group(0) @binding(7) var previousIds:texture_2d<u32>;
@group(0) @binding(8) var<uniform> view:ReflectionResolveView;
@group(0) @binding(9) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(10) var<storage,read> motion:array<mat4x4f>;
${taaReprojectWgsl(false)}
${PREVIOUS_DEPTH_WGSL}
${REFLECTION_PHASE_WGSL}
const REFLECTION_FILTER_RADIUS:f32=${REFLECTION_FILTER_RADIUS}.0;
const REFLECTION_FILTER_PLANE:f32=${REFLECTION_FILTER_PLANE};
const REFLECTION_MOVING_KEPT:f32=${REFLECTION_MOVING_KEPT}.0;
const REFLECTION_CLIP_SIGMAS:f32=${REFLECTION_CLIP_SIGMAS}.0;
const REFLECTION_CLIP_SAMPLES:f32=${REFLECTION_CLIP_SAMPLES}.0;
/** What \`roughSamples\` gathered round the pixel for the clip: the traced mean and its weight, and
 *  the per-channel deviation. */
var<private> neighbourhood:vec4f;
var<private> spread:vec3f;
fn pointAt(pixel:vec2f,z:f32)->vec3f{let position=clipAt(pixel,z);return position.xyz/position.w;}
fn roughSamples(at:vec2i,id:u32,nr:vec4f,z:f32)->vec4f{
 let drawn=vec2i(view.viewport.xy);let half=vec2i((drawn+vec2i(1))/2);
 let phase=reflectionPhase(u32(view.params.w));
 let base=vec2i(max(at-vec2i(3),vec2i(0))/2);
 let P=pointAt(vec2f(at)+vec2f(0.5),z);
 let radius=REFLECTION_FILTER_RADIUS*(1.0+nr.a);let reach=radius*radius;
 let plane=REFLECTION_FILTER_PLANE*REFLECTION_FILTER_PLANE;
 var sum=vec4f(0.0);var near=vec4f(0.0);var square=vec3f(0.0);
 let clipping=view.clip.x!=0.0;
 for(var k=0;k<16;k++){
  let q=base+vec2i(k&3,k>>2u);
  if(any(q>=half)){continue;}
  let owner=min(q*2+phase,drawn-vec2i(1));
  let apart=vec2f(owner-at);let far=dot(apart,apart);
  // Still, only the tent's texels are read; a clip reads every texel of the block.
  if(far>=reach&&!clipping){continue;}
  let traced=textureLoad(sampleColor,q,0);
  if(traced.a<=0.0){continue;}
  if(any(owner!=at)){
   if(textureLoad(ids,owner,0).r!=id){continue;}
   let other=textureLoad(normalRough,owner,0);
   if(dot(other.xyz,nr.xyz)<0.99||abs(other.a-nr.a)>0.001){continue;}
   let offset=pointAt(vec2f(owner)+vec2f(0.5),textureLoad(depth,owner,0))-P;
   let off=dot(offset,nr.xyz);
   if(off*off>plane*dot(offset,offset)){continue;}
  }
  near+=vec4f(traced.rgb*traced.a,traced.a);square+=traced.rgb*traced.rgb*traced.a;
  if(far>=reach){continue;}
  sum+=vec4f(traced.rgb*traced.a,traced.a)*(1.0-sqrt(far)/radius);
 }
 neighbourhood=vec4f(0.0);spread=vec3f(0.0);
 if(near.a>0.0){
  let mean=near.rgb/near.a;
  neighbourhood=vec4f(mean,near.a);spread=sqrt(max(square/near.a-mean*mean,vec3f(0.0)));
 }
 if(sum.a<=0.0){return vec4f(0.0);}
 return vec4f(sum.rgb/sum.a,sum.a);
}
@fragment fn resolveRoughReflection(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let at=vec2i(pixel.xy);let id=textureLoad(ids,at,0).r;
 let z=textureLoad(depth,at,0);let nr=textureLoad(normalRough,at,0);
 let expected=previousDepthOf(pixel.xy,z,id);
 var normal=nr.xyz;
 if(view.params.z!=0.0&&id!=0u){normal=(motion[placementOf(id)]*vec4f(normal,0.0)).xyz;}
 if(id==0u){return vec4f(0.0);}
 let current=roughSamples(at,id,nr,z);
 var history=vec4f(0.0);
 let uv=previousUv(at,z,id);
 if(view.params.x!=0.0&&uv.z!=0.0){
  let prior=vec2i(uv.xy*view.viewport.xy);
  let oldId=textureLoad(previousIds,prior,0).r;
  let oldNormal=textureLoad(previousNormal,prior,0);
  // Reject a different receiver, material lobe or shading normal before any mean is read.
  if(oldId==id&&dot(oldNormal.xyz,normal)>0.999&&abs(oldNormal.a-nr.a)<=0.001){
   let oldDepth=textureLoad(previousDepth,prior,0);
   if(abs(oldDepth-expected.x)<=expected.y){history=textureLoad(historyColor,prior,0);}
  }
 }
 // Moving, the history is clipped to the neighbourhood, or held short where too few texels say it.
 var cap=view.params.y;
 if(view.clip.x!=0.0&&history.a>0.0){
  if(neighbourhood.a>=REFLECTION_CLIP_SAMPLES){
   let box=REFLECTION_CLIP_SIGMAS*spread;
   history=vec4f(clamp(history.rgb,neighbourhood.rgb-box,neighbourhood.rgb+box),history.a);
  }else{cap=min(cap,REFLECTION_MOVING_KEPT);}
 }
 // A pixel no texel reached this image keeps its history as it is.
 let kept=select(min(history.a,cap*current.a),history.a,current.a<=0.0);
 let total=kept+current.a;
 if(total<=0.0){return vec4f(0.0);}
 let mean=history.rgb+(current.rgb-history.rgb)*(current.a/total);
 return vec4f(mean,min(total,${REFLECTION_HISTORY_WEIGHT}.0));
}`;

export function reflectionResolveLayout(device: GPUDevice) {
  const visibility = GPUShaderStage.FRAGMENT;
  return device.createBindGroupLayout({
    entries: [
      ...Array.from({ length: 8 }, (_, binding) => ({
        binding,
        visibility,
        texture: {
          sampleType: (binding === 2 || binding === 5
            ? 'depth'
            : binding === 4 || binding === 7
              ? 'uint'
              : 'unfilterable-float') as GPUTextureSampleType,
        },
      })),
      { binding: 8, visibility, buffer: { type: 'uniform' } },
      { binding: 9, visibility, buffer: { type: 'read-only-storage' } },
      { binding: 10, visibility, buffer: { type: 'read-only-storage' } },
    ],
  });
}
