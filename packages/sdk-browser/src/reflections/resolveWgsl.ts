import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { perspectiveDivide } from '../../../math/src/wgsl/projection.ts'
import { maxChannel } from '../../../math/src/wgsl/sampling.ts'
import { FULLSCREEN_VERTEX } from '../lighting/deferred/shaders.ts'
import { taaReprojectWgsl } from '../taa/shaderWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../visibility/shader/pageWgsl.ts'
import { REFLECTION_PHASE_WGSL } from './hizTraceWgsl.ts'
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts'
import { SCREEN_REFLECTION_CUTOFF } from './modelShader.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { HALF_MAX } from '../../../math/src/wgsl/constants.ts'

/** The weight a history stores at most: a bound on binary16 storage, never the window it keeps
 *  (`params.y`); binary16 has 1/32 weight spacing there, RGB arithmetic binary32. */
const REFLECTION_HISTORY_WEIGHT = 64
/** Frames a still history accumulates before the image may rest, and the frames of its own
 *  filtered weight it keeps at most: a rough reflection averages about this many
 *  reprojected frames behind a spatial filter. A declared class 2 on reflective pixels, bounded
 *  against the converged still image. */
export const REFLECTION_STILL_FRAMES = 12
/** The spatial filter's reach in pixels at roughness 0, twice it at roughness 1: a tent over the
 *  half-resolution texels traced around a pixel, kept on its receiver, lobe and plane. */
const REFLECTION_FILTER_RADIUS = 2
/** A neighbour off the pixel's plane by more than this share of its distance is another surface. */
const REFLECTION_FILTER_PLANE = 0.1
/** A neighbour, or the last image's point, whose roughness differs from the pixel's by more than
 *  this is another lobe. */
const REFLECTION_FILTER_ROUGHNESS = 0.001
/** The roughness range a pixel's filter can meet a traced sample in: the trace's own, above the
 *  floor and under the cutoff (`sampleWgsl.ts`), widened by the lobe tolerance the filter accepts a
 *  neighbour within, twice for the rounding of the compares. Outside it, every texel the filter
 *  accepts, the pixel's own and its lobe's, holds no weight: no gather can find one. */
const REFLECTION_GATHER_LOW = ROUGHNESS_FLOOR - 2 * REFLECTION_FILTER_ROUGHNESS
const REFLECTION_GATHER_HIGH = SCREEN_REFLECTION_CUTOFF + 2 * REFLECTION_FILTER_ROUGHNESS
/** The frames of its own weight a history keeps while its sources or camera move at a pixel whose
 *  neighbourhood holds too few traced samples to clip it by (`REFLECTION_CLIP_SAMPLES`): a
 *  reflection there lags them by about this many frames. Everywhere else the history keeps its
 *  whole window, clipped. */
const REFLECTION_MOVING_KEPT = 4
/** The reflection denoiser after its temporal pass: while its sources or camera move, a
 *  history holding fewer frames of its own weight than the moving window plus this image, or
 *  clipped, widens the filter: its area grows by the frames it lacks, its reach by their square
 *  root, up to `REFLECTION_FILTER_WIDEST` times. Still, the filter keeps its width. */
const REFLECTION_FILTER_FRAMES = REFLECTION_MOVING_KEPT + 1
const REFLECTION_FILTER_WIDEST = 2
/** While its sources or camera move, a history's mean is clipped to this image's neighbourhood —
 *  the traced texels around the pixel on its receiver, lobe and plane — at its mean plus or minus
 *  this many standard deviations, as a temporal variance clip does: a reflection
 *  that changed leaves the box and follows at once, one that did not keeps its whole window and
 *  its noise averaged. Two deviations hold the converged mean of up to sixteen noisy samples. */
const REFLECTION_CLIP_SIGMAS = 2
/** The traced weight a neighbourhood needs before its deviation is trusted to clip a history. */
const REFLECTION_CLIP_SAMPLES = 4
/** The share of the history's moment — the mean square of its samples' brightest channel — each
 *  image renews with its neighbourhood's. A small bright source in a rough lobe (a
 *  highlight, a lamp) is met by a few samples in a hundred: most neighbourhoods hold none, their
 *  deviation is that of the dim rest, and a clip by it alone took the source out of every history:
 *  half to two thirds of the reflection lost, the rest a grain of sparks. The deviation the clip
 *  allows is never under the moment's, about the last four images' samples: a source still met is
 *  kept; one gone leaves the moment in a few images, and the clip follows. */
const REFLECTION_MOMENT_RENEWED = 0.25
/** The frames of its own weight a history keeps across a placement change it cannot follow:
 *  a moved or newly resident source's stale share halves each frame, whatever weight W the filter
 *  gathers there (about 1 on a glossy receiver, more on a rough one), while a moving view, which
 *  changes probes every frame, still averages two samples rather than restarting from one, which
 *  flickers. */
export const REFLECTION_CHANGE_KEPT = 1
/** Frames a changed source keeps `REFLECTION_CHANGE_KEPT`: the stale share falls to
 *  (1/2)^8 = 1/256 at any roughness, under a 1/255 step, and the still window after it dilutes it
 *  further: a held image keeps nothing of what a reflection showed before, and the change
 *  plus the window close within 20 frames. */
export const REFLECTION_CHANGE_FRAMES = 8
export const REFLECTION_RESOLVE_VIEW_BYTES = 176

/** Unclipped, the rows and columns of the gather's block a texel inside the tent can lie on: an
 *  owner `owner = min(2·(base + k) + phase, drawn − 1)`, nondecreasing in `k`, at `r = ⌈radius⌉`
 *  or more off the pixel on an axis lies past it — its squared distance, an integer, is at least
 *  `radius²`, so at least the reach, its rounding —, and the gather passed it unread. On an axis the
 *  owner lies above `at − r` exactly where `2·(base + k) + phase` does (a clamped owner is the last
 *  pixel, at or past `at`), and under `at + r` where it does or the last pixel is: `lower` and
 *  `upper` bound those `k`, in integer-valued floats. Clipping, the whole block is read. The loops
 *  visit the others in their order: the sums are the same, bit for bit. */
const GATHER_BOUNDS = ` var lower=vec2i(0);var upper=vec2i(span);
 if(!clipping){
  let r=ceil(radius);let lowest=vec2f(at-phase-2*base);
  lower=max(vec2i(floor((lowest-r)*0.5))+1,lower);
  upper=min(select(vec2i(ceil((lowest+r)*0.5)),upper,vec2f(drawn-1-at)<vec2f(r)),upper);
 }`

const BOUNDED = ' for(var y=lower.y;y<upper.y;y++){for(var x=lower.x;x<upper.x;x++){'

/** The depth the point drawn at pixel `coord` (depth `z`, identifier `id`) had on the last image,
 *  moved back by its placement's motion while `params.z` says it is live (`pixelPoint`,
 *  `pointBefore`: the temporal antialiasing's own reprojection, `taaReprojectWgsl`), and the
 *  one-pixel slope a stored depth may differ from it by. It is called before any non-uniform
 *  return: the slope is a derivative. A stored depth off it is another surface, the point was hidden (disocclusion): the
 *  history resolve and the reflection source (`sourceWgsl.ts`) reject by it. */
export const PREVIOUS_DEPTH_WGSL = wgslBlock(
  'PREVIOUS_DEPTH_WGSL',
  [],
  `
fn previousDepthOf(coord:vec2i,z:f32,id:u32)->vec2f{
 let projected=view.prevViewProj*pointBefore(pixelPoint(coord,z),id);
 let expected=projected.z/projected.w;
 return vec2f(expected,max(abs(dpdx(expected))+abs(dpdy(expected)),1e-7));
}`,
)

/** Dedicated ratio-estimator resolve. It shares only reprojection mathematics
 * with TAA: no neighbourhood clamp, colour transform or TAA history is involved.
 * The trace ran at half resolution, each texel for one pixel of its 2 × 2 block
 * (`reflectionPhase`): a pixel takes the 4 × 4 texels around it whose pixel is on its
 * receiver, lobe and plane, each by a tent of its distance (`REFLECTION_FILTER_RADIUS`): the
 * ray reuse and the bilateral spatial filter in one gather. History follows the
 * placement motion (`params.z`) and is dropped only where its receiver, normal
 * or depth disagree; `params.y` caps it in frames of this image's filtered weight (the still
 * window, or `REFLECTION_CHANGE_KEPT` after a change it cannot follow): the share a frame renews is
 * the same at every roughness. `params.w` is the trace seed's low bits. While its sources or camera
 * move (`clip.x`), the history's mean is clipped to the neighbourhood of this image's samples
 * (`REFLECTION_CLIP_SIGMAS`) instead of its window being shortened; still, nothing is clipped. A
 * history short or clipped widens this image's filter (`REFLECTION_FILTER_FRAMES`). The gather
 * reads the identifier and depth of a texel's pixel (`owner`) off the one it resolves from the
 * record the trace wrote at the texel (`owners`, `sampleWgsl.ts`): one read where there were two,
 * the same bits. */
export const REFLECTION_RESOLVE_WGSL = wgslProgram(
  `
struct ReflectionResolveView{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,clip:vec4f,}
/** The mean and its weight; the root mean square of the samples' brightest channel. */
struct ReflectionResolved{@location(0) mean:vec4f,@location(1) moment:f32,}
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
@group(0) @binding(11) var historyMoment:texture_2d<f32>;
@group(0) @binding(12) var owners:texture_2d<u32>;
const REFLECTION_FILTER_RADIUS:f32=${REFLECTION_FILTER_RADIUS}.0;
const REFLECTION_FILTER_PLANE:f32=${REFLECTION_FILTER_PLANE};
const REFLECTION_FILTER_ROUGHNESS:f32=${REFLECTION_FILTER_ROUGHNESS};
const REFLECTION_GATHER_LOW:f32=${REFLECTION_GATHER_LOW};
const REFLECTION_GATHER_HIGH:f32=${REFLECTION_GATHER_HIGH};
const REFLECTION_FILTER_FRAMES:f32=${REFLECTION_FILTER_FRAMES}.0;
const REFLECTION_FILTER_WIDEST:f32=${REFLECTION_FILTER_WIDEST}.0;
const REFLECTION_MOVING_KEPT:f32=${REFLECTION_MOVING_KEPT}.0;
const REFLECTION_CLIP_SIGMAS:f32=${REFLECTION_CLIP_SIGMAS}.0;
const REFLECTION_CLIP_SAMPLES:f32=${REFLECTION_CLIP_SAMPLES}.0;
const REFLECTION_MOMENT_RENEWED:f32=${REFLECTION_MOMENT_RENEWED};
/** What \`roughSamples\` gathered round the pixel for the clip, unwidened: the traced mean and its
 *  weight, and the per-channel deviation; the mean square of every texel's brightest channel it
 *  read, -1 with none. */
var<private> neighbourhood:vec4f;
var<private> spread:vec3f;
var<private> moment:f32;
/** The 4 × 4 block's texels the clip's gather accepted, one bit each: a widened gather reads them
 *  again without testing them again, and the others not at all. */
var<private> accepted:u32;
fn pointAt(coord:vec2i,z:f32)->vec3f{return perspectiveDivide(pixelPoint(coord,z));}
// \`widen\` scales the tent's reach; a widened gather follows the clip's, so it gathers none.
fn roughSamples(at:vec2i,id:u32,nr:vec4f,z:f32,widen:f32)->vec4f{
 let drawn=vec2i(view.viewport.xy);let half=vec2i((drawn+vec2i(1))/2);
 let phase=reflectionPhase(u32(view.params.w));
 let wide=widen>1.0;let span=select(4,8,wide);
 let base=vec2i(max(at-vec2i(span-1),vec2i(0))/2);
 let P=pointAt(at,z);
 let radius=REFLECTION_FILTER_RADIUS*(1.0+nr.a)*widen;let reach=radius*radius;
 let plane=REFLECTION_FILTER_PLANE*REFLECTION_FILTER_PLANE;
 var sum=vec4f(0.0);var near=vec4f(0.0);var square=vec3f(0.0);var bright=vec2f(0.0);
 let clipping=view.clip.x!=0.0&&!wide;
 let first=vec2i(max(at-vec2i(3),vec2i(0))/2);if(!wide){accepted=0u;}
${GATHER_BOUNDS}\n${BOUNDED}
  let q=base+vec2i(x,y);
  if(any(q>=half)){continue;}
  let owner=min(q*2+phase,drawn-vec2i(1));
  let apart=vec2f(owner-at);let far=dot(apart,apart);
  // Still, only the tent's texels are read; a clip reads every texel of the block.
  if(far>=reach&&!clipping){continue;}
  // Widened, a texel of the clip's block is taken as the clip's gather tested it: one it refused
  // is not read again.
  let inner=q-first;let bit=1u<<u32(inner.x+4*inner.y);
  let tested=wide&&all(inner>=vec2i(0))&&all(inner<vec2i(4));
  if(tested&&(accepted&bit)==0u){continue;}
  let traced=textureLoad(sampleColor,q,0);
  if(traced.a<=0.0){continue;}
  if(!tested&&any(owner!=at)){let record=textureLoad(owners,q,0);
   if(record.x!=id){continue;}
   let other=textureLoad(normalRough,owner,0);
   if(dot(other.xyz,nr.xyz)<0.99||abs(other.a-nr.a)>REFLECTION_FILTER_ROUGHNESS){continue;}
   let offset=pointAt(owner,bitcast<f32>(record.y))-P;
   let off=dot(offset,nr.xyz);
   if(off*off>plane*dot(offset,offset)){continue;}
  }
  if(clipping){accepted=accepted|bit;near+=vec4f(traced.rgb*traced.a,traced.a);square+=traced.rgb*traced.rgb*traced.a;}
  if(!wide){let top=maxChannel(traced.rgb);bright+=vec2f(top*top,1.0)*traced.a;}
  if(far>=reach){continue;}
  sum+=vec4f(traced.rgb*traced.a,traced.a)*(1.0-sqrt(far)/radius);
 }}
 if(!wide){
  neighbourhood=vec4f(0.0);spread=vec3f(0.0);moment=select(-1.0,bright.x/bright.y,bright.y>0.0);
  if(clipping&&near.a>0.0){
   let mean=near.rgb/near.a;
   neighbourhood=vec4f(mean,near.a);spread=sqrt(max(square/near.a-mean*mean,vec3f(0.0)));
  }
 }
 if(sum.a<=0.0){return vec4f(0.0);}
 return vec4f(sum.rgb/sum.a,sum.a);
}
@fragment fn resolveRoughReflection(@builtin(position) pixel:vec4f)->ReflectionResolved{
 let at=vec2i(pixel.xy);let id=textureLoad(ids,at,0).r;
 let z=textureLoad(depth,at,0);let nr=textureLoad(normalRough,at,0);
 let expected=previousDepthOf(vec2i(pixel.xy),z,id);
 if(id==0u){return ReflectionResolved(vec4f(0.0),0.0);}
 // Outside the range a trace reaches, nothing is gathered: no weight, no moment (-1).
 let gathers=nr.a>REFLECTION_GATHER_LOW&&nr.a<REFLECTION_GATHER_HIGH;
 var current=vec4f(0.0);var gathered=-1.0;
 if(gathers){current=roughSamples(at,id,nr,z,1.0);gathered=moment;}
 var history=vec4f(0.0);var heldMoment=0.0;
 let uv=previousUv(at,z,id);
 if(view.params.x!=0.0&&uv.z!=0.0){
  let prior=vec2i(uv.xy*view.viewport.xy);
  // Gathering nothing, a weightless history keeps none (\`kept\`, \`total\`): nothing, whatever the
  // last image held there, and none of it read.
  if(!gathers&&textureLoad(historyColor,prior,0).a<=0.0){return ReflectionResolved(vec4f(0.0),0.0);}
  let oldId=textureLoad(previousIds,prior,0).r;
  let oldNormal=textureLoad(previousNormal,prior,0);
  var normal=nr.xyz;
  if(view.params.z!=0.0){normal=(motion[placementOf(id)]*vec4f(normal,0.0)).xyz;}
  // Reject a different receiver, material lobe or shading normal before any mean is read (but a
  // pixel gathering nothing, whose weight it read above).
  if(oldId==id&&dot(oldNormal.xyz,normal)>0.999&&abs(oldNormal.a-nr.a)<=REFLECTION_FILTER_ROUGHNESS){
   let oldDepth=textureLoad(previousDepth,prior,0);
   if(abs(oldDepth-expected.x)<=expected.y){
    history=textureLoad(historyColor,prior,0);heldMoment=textureLoad(historyMoment,prior,0).r;
   }
  }
 }
 // The moment the history keeps, renewed by this image's neighbourhood.
 var square=gathered;
 if(history.a>0.0){
  let held=heldMoment*heldMoment;
  square=select(held,held+(gathered-held)*REFLECTION_MOMENT_RENEWED,gathered>=0.0);
 }
 // Moving, the history is clipped to the neighbourhood, or held short where too few texels say it.
 var cap=view.params.y;var clipped=false;
 if(view.clip.x!=0.0&&history.a>0.0){
  if(neighbourhood.a>=REFLECTION_CLIP_SAMPLES){
   // Its deviation, never under the moment's about the history's mean.
   let top=maxChannel(history.rgb);
   let box=REFLECTION_CLIP_SIGMAS*max(spread,vec3f(sqrt(max(square-top*top,0.0))));
   let inside=clamp(history.rgb,neighbourhood.rgb-box,neighbourhood.rgb+box);
   clipped=any(inside!=history.rgb);
   history=vec4f(inside,history.a);
  }else{cap=min(cap,REFLECTION_MOVING_KEPT);}
 }
 // Moving, a short or clipped history: the spatial filter widens by the frames it lacks.
 let frames=select(min(history.a,cap*current.a)/max(current.a,1e-6),0.0,clipped);
 let widen=min(sqrt(REFLECTION_FILTER_FRAMES/(frames+1.0)),REFLECTION_FILTER_WIDEST);
 if(view.clip.x!=0.0&&widen>1.0&&current.a>0.0){current=roughSamples(at,id,nr,z,widen);}
 // A pixel no texel reached this image keeps its history as it is.
 let kept=select(min(history.a,cap*current.a),history.a,current.a<=0.0);
 let total=kept+current.a;
 let root=min(sqrt(max(square,0.0)),HALF_MAX);
 if(total<=0.0){return ReflectionResolved(vec4f(0.0),root);}
 let mean=history.rgb+(current.rgb-history.rgb)*(current.a/total);
 return ReflectionResolved(vec4f(mean,min(total,${REFLECTION_HISTORY_WEIGHT}.0)),root);
}`,
  [
    FULLSCREEN_VERTEX,
    PAGE_INFO_STRUCT_WGSL,
    PREVIOUS_DEPTH_WGSL,
    REFLECTION_PHASE_WGSL,
    taaReprojectWgsl(false),
    maxChannel,
    perspectiveDivide,
    HALF_MAX,
  ],
)
