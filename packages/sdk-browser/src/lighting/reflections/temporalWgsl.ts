import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { ndcToPixel, pixelToNdc, slabPerspective } from '../../../../math/src/wgsl/projection.ts'
import { interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import { makeFinite, makeFinite3 } from '../../../../math/src/wgsl/integer.ts'
import { REFLECTION_HISTORY_FORMAT } from './grids.ts'
import { REFLECTION_SIDE } from './constants.ts'
import {
  REFLECTION_LAYER_WGSL,
  REFLECTION_TILES_WGSL,
  REFLECTION_TRACE_BINDINGS as B,
} from './trace/traceBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'
import { ACCUMULATION_WGSL } from '../../post/taa/accumulationWgsl.ts'
import { YCOCG_WGSL } from '../../post/taa/ycocgWgsl.ts'
import { SURFACE_PAST_WGSL } from '../bounce/screen/vectorsWgsl.ts'
import { REFLECTION_VECTORS_WGSL } from './past.ts'

/** The border of the resolved pixels a tile of the accumulation stages around its own, the
 *  neighbourhood's reach (a 5 × 5 window's half), and the side of what it stages. */
const BORDER = 2
const SHARED = REFLECTION_SIDE + 2 * BORDER

/**
 * THE TEMPORAL ACCUMULATION of a surface (`temporalSurface`), a thread a pixel of a resolve tile:
 * each pixel blends its resolved radiance (`temporalIn`, `resolveWgsl.ts`) with its history
 * (`historyIn`, the last image's) and writes the history the next image blends with and the last pass
 * reads (`historyOut`, `bilateralWgsl.ts`). A pixel whose resolve gave nothing writes no history. One
 * rule for every pixel, on every image: a pixel's history is its own, kept or refused by its own
 * surface alone — a change elsewhere in the scene neither shortens nor restarts it.
 *
 * - NEIGHBOURHOOD: the tile's resolved pixels and a border of two staged once in workgroup memory,
 *   denoised and in YCoCg, as halves (two `pack2x16float` words), corners and
 *   pixels past the viewport left out; a pixel's window, 5 × 5 but its corners, its own resolved value
 *   weighing one, gives their mean, the centre, and `clampScale` standard deviations, the extent.
 * - TWO HISTORIES: one reprojected from the surface,
 *   the pixel's point `P` through the last image's view-projection (`ReflectionView.radianceViewProj`,
 *   the one previous view of the engine), both images' jitter taken off (`temporalHistoryNdc`) — carried further by the surface's own motion where the pixel
 *   moves by itself, the vector the velocity stage drew less the camera's (`temporalOwnMotion`) and the depth step it drew
 *   less the camera's (`temporalOwnDepth`), the hit's history by the same motion —, its four texels kept as their depth lies within
 *   the history distance threshold of the reprojected one, jittered by the image's noise and widened as
 *   the surface turns edge-on; and, for a lobe narrow enough that its direction matters more than the
 *   surface's motion (its dominant-direction factor past ½), one reprojected from the hit, the point the
 *   reflection seems to lie at — along the pixel's view ray, its depth plus the hit's distance —, its
 *   texels taken whatever their depth (a reflected point has no depth of its own to test). Either
 *   reads the last image's history inside the last image's drawn size alone
 *   (`ReflectionView.radiance.xy`, its bilinear footprint held within it, so no texel past it bleeds
 *   in), texels without a history left out; none kept, none. No history either where there is none to
 *   read (`reflectionView.traced`): an image whose screen is not traced, or whose history the settings turn off.
 * - CLAMP: each history, in YCoCg, held within the centre ± the window's extent, the neighbourhood's
 *   alone; the surface's taken whole, unless the hit's lies nearer the centre — then 0.8 of the
 *   surface's, a fifth of the hit's, so one error never loses the history at once —, the hit's alone
 *   where the surface has none. The farther the clamp moved it, `length(|Δ| / max(extent, 0.1))` — the
 *   0.1 of its pre-exposed space, this image's pre-exposure divided out (`REFLECTION_CLAMP_FLOOR`) —, the
 *   less it is trusted, `0.75 · saturate(1 − d) + 0.25`. The history's second moment of luminance is
 *   carried for the next image as it is, by the same share of the two histories.
 * - BLEND: the count of the history chosen (the surface's past 0.5 of it) times that
 *   trust, plus one, the history's images at most (`ACCUMULATION_WGSL`) — two images for a mirror traced at full
 *   resolution, lerped to the setting's by the top layer's roughness over `REFLECTION_MIRROR_ROUGHNESS`,
 *   `reflectionMaxFrames` —; the resolved value taken at one over that count. What is stored is made finite
 *   and held above zero.
 *
 * A RECONSTRUCTED SAMPLE is a pixel that is not its 2 × 2 block's jitter pixel
 * (`reflectionJitter`): its resolved value was interpolated from its neighbours' rays, so its window,
 * less precise, is twice as wide, and it takes its resolved value at one over the count
 * plus four — over a few images it converges to a properly upscaled result.
 */
export const REFLECTION_TEMPORAL_WGSL = wgslBlock(
  'REFLECTION_TEMPORAL_WGSL',
  [
    REFLECTION_LAYER_WGSL,
    REFLECTION_TILES_WGSL,
    REFLECTION_SURFACES_WGSL,
    REFLECTION_TEXEL_WGSL,
    ACCUMULATION_WGSL,
    // YCoCg and back: the clamp's box is tighter around luminance and chroma than around RGB.
    YCOCG_WGSL,
    ndcToPixel,
    pixelToNdc,
    SURFACE_PAST_WGSL,
    REFLECTION_VECTORS_WGSL,
    slabPerspective,
    interleavedGradientNoise,
    makeFinite,
    makeFinite3,
  ],
  `@group(0) @binding(${B.temporalIn}) var temporalIn:texture_2d<u32>;
@group(0) @binding(${B.historyIn}) var historyIn:texture_2d<u32>;
@group(0) @binding(${B.historyOut}) var historyOut:texture_storage_2d<${REFLECTION_HISTORY_FORMAT},write>;
/** The tile's resolved pixels and their border, denoised, in YCoCg, their weight in \`w\`, as halves. */
var<workgroup> temporalShared:array<vec2u,${SHARED * SHARED}>;
fn temporalShare(s:vec2i)->vec4f{
 let p=temporalShared[u32(s.y)*${SHARED}u+u32(s.x)];
 return vec4f(unpack2x16float(p.x),unpack2x16float(p.y));
}
/** Stages the resolved pixels of the tile at pixel \`origin\` and their border, thread \`lane\`'s share,
 *  a fixed count of turns: the window's corners and the pixels past the viewport weigh nothing. */
fn temporalStage(origin:vec2i,lane:u32){
 let size=vec2i(reflectionViewport());
 for(var turn=0u;turn<${ceilDiv(SHARED * SHARED, REFLECTION_SIDE * REFLECTION_SIDE)}u;turn++){
  let i=lane+turn*${REFLECTION_SIDE * REFLECTION_SIDE}u;
  if(i<${SHARED * SHARED}u){
   let s=vec2i(i32(i%${SHARED}u),i32(i/${SHARED}u));
   let at=origin+s-vec2i(${BORDER});
   let corner=(s.x==0||s.x==${SHARED - 1})&&(s.y==0||s.y==${SHARED - 1});
   var v=vec4f(0.0);
   if(!corner&&all(at>=vec2i(0))&&all(at<size)){
    let t=textureLoad(temporalIn,at,0).xy;
    if(freshValid(t)){v=vec4f(toYcocg(reflectionDenoised(texelRadiance(t))),1.0);}
   }
   temporalShared[i]=vec2u(pack2x16float(v.xy),pack2x16float(v.zw));
  }
 }
}
/** A window of the neighbourhood around the pixel of the tile \`local\` whose own
 *  value is \`centre\`: its mean, the centre, and its extent, in YCoCg. */
struct TemporalWindow{centre:vec3f,extent:vec3f,}
fn temporalWindow(local:vec2u,centre:vec3f)->TemporalWindow{
 var sum=centre;
 var square=centre*centre;
 var n=1.0;
 for(var k=0;k<25;k++){
  let o=vec2i(k%5-2,k/5-2);
  if((abs(o.x)==2&&abs(o.y)==2)||all(o==vec2i(0))){continue;}
  let v=temporalShare(vec2i(local)+vec2i(${BORDER})+o);
  sum+=v.xyz;
  square+=v.xyz*v.xyz;
  n+=v.w;
 }
 let m=sum/n;
 return TemporalWindow(m,reflectionView.denoise.y*sqrt(max(square/n-m*m,vec3f(0.0))));
}
/** How far, in device position, the surface of the pixel \`coord\` moves by itself beyond the camera's
 *  motion, from the vector the velocity stage drew (\`temporalVectors\`): where the camera alone puts the
 *  surface's point in the last image less where the vector says it stood (\`surfacePast\`) — what a
 *  history is carried by in the last image where the pixel is dynamic. Both are compared without the
 *  jitter of either view-projection (\`ReflectionView.jitter\`), as the vectors are drawn: \`camera\`, the
 *  point's position through the last, jittered, view-projection. Zero for a pixel that moves by the
 *  camera alone, and for the transparents' front surface, which has no vector. */
fn temporalOwnMotion(coord:vec2i,camera:vec2f)->vec2f{
 if(REFLECTION_LAYER!=0u){return vec2f(0.0);}
 let last=vec2i(textureDimensions(temporalVectors))-vec2i(1);
 let word=textureLoad(temporalVectors,clamp(coord,vec2i(0),last),0).r;
 let jitter=reflectionView.jitter;
 let here=pixelToNdc(vec2f(coord)+vec2f(0.5),vec2f(reflectionViewport()))-jitter.xy;
 let still=camera-jitter.zw;
 return still-surfacePast(word,here,still);
}
/** How far, in device depth, the surface of the pixel \`coord\` moves by itself beyond the camera's motion: the depth step the velocity stage
 *  drew in its flags word (\`depthStepOf\`) less the depth the camera alone takes off the surface, \`nowZ\` its device depth in this image
 *  less \`cameraZ\` the device depth of its point in the last view-projection. Zero for a pixel that moves by the camera alone, and for
 *  the transparents' front surface. */
fn temporalOwnDepth(coord:vec2i,nowZ:f32,cameraZ:f32)->f32{
 if(REFLECTION_LAYER!=0u){return 0.0;}
 let last=vec2i(textureDimensions(temporalVectors))-vec2i(1);
 let words=textureLoad(temporalVectors,clamp(coord,vec2i(0),last),0);
 if(!hasOwnMotion(words.r)){return 0.0;}
 return depthStepOf(words.g)-(nowZ-cameraZ);
}
/** A history: its radiance in the denoiser's space, its luminance's second moment there, its count,
 *  whether it holds. */
struct TemporalHistory{radiance:vec3f,moment:f32,count:f32,valid:bool,}
/** Where a point seen at \`clip\` (its position through the last, jittered, view-projection) lies in the history, which holds the
 *  pixels of every image at their centre: the jitter of either view-projection is taken off, as the vectors are drawn
 *  (\`temporalOwnMotion\`), and the pixel's own centre put back (\`jitter.xy\`), so a still view reads its history texel for texel. */
fn temporalHistoryNdc(clip:vec4f)->vec2f{
 let jitter=reflectionView.jitter;
 return clip.xy/clip.w-jitter.zw+jitter.xy;
}
/** The history of the point the last image saw at \`clip\` (its position through the last
 *  view-projection), carried by the surface's own motion \`own\` (\`temporalOwnMotion\`, its device depth \`temporalOwnDepth\` in \`z\`:
 *  the depth the history is expected at is the point's less that step); \`surface\`,
 *  whether that point is the pixel's own, of normal \`N\` seen from \`V\` — its texels then kept as their
 *  depth agrees —, or the hit's. */
fn temporalHistory(clip:vec4f,own:vec3f,surface:bool,N:vec3f,V:vec3f,noise:f32)->TemporalHistory{
 var held=TemporalHistory(vec3f(0.0),0.0,0.0,false);
 if(clip.w<=0.0){return held;}
 let size=reflectionView.radiance.xy;
 let screen=ndcToPixel(temporalHistoryNdc(clip)-own.xy,size);
 if(any(screen<vec2f(0.0))||any(screen>size)){return held;}
 let at=clamp(screen,vec2f(0.51),size-vec2f(0.51))-vec2f(0.5);
 let corner=vec2i(floor(at));
 let f=at-floor(at);
 // A surface that moves by itself stood at the depth the camera puts it at less its own step; one that does not, at its clip depth.
 let depth=select(reflectionLinearDepth(clip),reflectionLinearOfDevice(clip.z/clip.w-own.z),own.z!=0.0);
 var threshold=reflectionView.denoise.z*mix(0.5,1.5,noise);
 if(surface){threshold/=clamp(dot(V,N),0.1,1.0);}
 var sum=vec3f(0.0);
 var moment=0.0;
 var weights=0.0;
 var count=0.0;
 var kept=false;
 for(var k=0u;k<4u;k++){
  let o=vec2u(k&1u,k>>1u);
  let t=textureLoad(historyIn,corner+vec2i(o),0);
  if(!historyValid(t)){continue;}
  if(surface&&abs(historyDepth(t)-depth)>=depth*threshold){continue;}
  let w=mix(1.0-f.x,f.x,f32(o.x))*mix(1.0-f.y,f.y,f32(o.y));
  kept=kept||w>0.01;
  sum+=w*reflectionDenoised(texelRadiance(t.xy));
  moment+=w*historyMoment(t);
  count+=w*historyCount(t);
  weights+=w;
 }
 if(!kept){return held;}
 return TemporalHistory(sum/weights,moment/weights,count/weights,true);
}
/** The point the reflection at \`P\`, seen from \`V\`, seems to lie at, \`hit\` beyond it: along the pixel's
 *  view ray, its depth plus the hit's distance. */
fn temporalHitPoint(P:vec3f,V:vec3f,hit:f32)->vec3f{
 if(!slabPerspective(reflectionView.slab)){return P-V*hit;}
 return P-V*hit*distance(view.camera.xyz,P)/(reflectionView.viewProj*vec4f(P,1.0)).w;
}
/** The history pixel \`coord\` writes, thread \`local\` of its tile, on the surface \`layer\`. */
fn temporalPixel(coord:vec2i,local:vec2u,layer:u32)->vec4u{
 let mine=temporalShare(vec2i(local)+vec2i(${BORDER}));
 if(mine.w<0.5){return vec4u(0u);}
 var lighting=fromYcocg(mine.xyz);
 // The fresh second moment: the resolved luminance squared, in the denoiser's space.
 var moment=luminance(lighting)*luminance(lighting);
 // The lobe's roughness as the material gives it: the bias toward a mirror (\`reflectionSmoothed\`) is the rays', the resolve's and the filter's, not the accumulation's.
 let top=surfaceTopRawAt(coord,surfaceFlagsAt(coord));
 let P=surfacePointAt(layer,coord);
 let V=viewToEye(P);
 var count=0.0;
 if(reflectionView.traced.x!=0u&&reflectionDone(REFLECTION_TEMPORAL)){
  // The interleaved gradient noise at the pixel, the image's turn modulo eight.
  let noise=interleavedGradientNoise(vec2f(coord),f32(reflectionView.temporal.y));
  let camera=reflectionView.radianceViewProj*vec4f(P,1.0);
  let now=reflectionView.viewProj*vec4f(P,1.0);
  let own=select(vec3f(0.0),vec3f(temporalOwnMotion(coord,camera.xy/camera.w),temporalOwnDepth(coord,now.z/now.w,camera.z/camera.w)),camera.w>0.0&&now.w>0.0);
  var fromHit=TemporalHistory(vec3f(0.0),0.0,0.0,false);
  // The dominant-direction factor of the lobe it traces, r its roughness: s·(√s + r), s = 1 − r
  // (Lagarde & de Rousiers 2014).
  let s=saturate(1.0-top.w);
  if(s*(sqrt(s)+top.w)>0.5){
   let hit=freshHit(textureLoad(temporalIn,coord,0).xy);
   let seen=reflectionView.radianceViewProj*vec4f(temporalHitPoint(P,V,hit),1.0);
   fromHit=temporalHistory(seen,own,false,top.xyz,V,noise);
  }
  let fromSurface=temporalHistory(camera,own,true,top.xyz,V,noise);
  if(fromSurface.valid||fromHit.valid){
   let reconstructed=any(vec2u(coord)%reflectionBlock()!=reflectionJitter(vec2u(coord)/reflectionBlock()));
   let window=temporalWindow(local,mine.xyz);
   let hitY=toYcocg(fromHit.radiance);
   let surfaceY=toYcocg(fromSurface.radiance);
   var alpha=0.0;
   if(length(window.centre-hitY)>length(window.centre-surfaceY)+0.01/max(view.preExposure.x,REFLECTION_EPSILON)){alpha=0.8;}
   alpha=select(1.0,alpha,fromHit.valid);
   let history=mix(hitY,surfaceY,alpha);
   // The history's second moment, by the share of the history chosen: carried into the moment it stores as it is.
   let heldMoment=mix(fromHit.moment,fromSurface.moment,alpha);
   let extent=window.extent*select(1.0,2.0,reconstructed);
   let lo=window.centre-extent;
   let hi=window.centre+extent;
   let clamped=mix(clamp(hitY,lo,hi),clamp(surfaceY,lo,hi),alpha);
   let least=vec3f(REFLECTION_CLAMP_FLOOR/max(view.preExposure.x,REFLECTION_EPSILON));
   let trust=0.75*saturate(1.0-length(abs(clamped-history)/max(extent,least)))+0.25;
   let held=select(fromHit.count,fromSurface.count,alpha>0.5);
   // A full-resolution mirror leans on the temporal anti-aliasing for the rest of its noise: its history is two images,
   // widening to the setting's with the roughness of its top layer over 0.05.
   var most=reflectionView.denoise.x;
   if(all(reflectionBlock()==vec2u(1u))){most=reflectionMaxFrames(most,top.w);}
   count=accumulationCount(held*trust,1.0,most);
   let fresh=1.0/(count+select(0.0,4.0,reconstructed));
   let kept=fromYcocg(clamped);
   moment=mix(heldMoment,moment,fresh);
   lighting=mix(kept,lighting,fresh);
  }
 }
 // Neither an infinity nor a NaN reaches the history: the radiance and its moment are made finite, then held above zero.
 return historyPack(reflectionLinear(max(makeFinite3(lighting),vec3f(0.0))),surfaceLinearDepth(P),max(makeFinite(moment),0.0),count);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn temporalSurface(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 let t=reflectionTileOf(tile,groups);
 if(t==REFLECTION_NO_TILE){return;}
 let origin=reflectionTileOrigin(t);
 temporalStage(vec2i(origin),lane);
 workgroupBarrier();
 let id=origin+local.xy;
 if(any(id>=reflectionViewport())){return;}
 textureStore(historyOut,id,temporalPixel(vec2i(id),local.xy,REFLECTION_LAYER));
}`,
)
