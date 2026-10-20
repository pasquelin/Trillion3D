import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { clampToExtent } from '../../../math/src/wgsl/sampling.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { VIEW_WGSL } from '../lighting/deferred/worldAtWgsl.ts'

/** Texels of a level one workgroup makes of the level two finer: `REFLECTION_SIDE`, each reading
 *  the four texels of the level between that surround it — a tile of `2 · REFLECTION_SIDE` and a
 *  texel of halo each side. */
const TILE = 2 * REFLECTION_SIDE + 2

/** The pyramid's bindings (`RADIANCE_SHADER`), the one table its WGSL, its layouts
 *  (`radianceLayouts`) and its groups read: the level read, the two written, their sampler and the
 *  lighting's view. */
export const RADIANCE_BINDINGS = {
  finer: 0,
  coarser: 1,
  coarsest: 2,
  halves: 3,
  view: 4,
} as const

/**
 * The radiance pyramid: the lit image of the frame, before the temporal resolve, and its filtered
 * levels, which the next image's reflections read over their footprints. Level 0 is the lit image
 * itself, no copy of it: the frame's HDR target is one of two that take turns (`adoptRadianceImage`),
 * so the one the last image lit stays whole while this image lights the other, and the reflections
 * read it as it is (`reflectionImage`, `footprint.ts`). Its coverage is within one wherever a
 * surface drew — the lighting writes 1 or 0, the blends keep it or blend it over — and it is zero
 * past the drawn size, which the lighting's clear zeroes over the whole target and no pass draws
 * past: the very texels the copy it replaces held. The pyramid holds levels 1 and after in the
 * mips of that very target (`hdrTargetDescriptor`): a reader binds one texture for every level.
 *
 * Each level is the one before it through the separable tent [1, 3, 3, 1] / 8 on each axis, centred
 * on the coarse texel (the four finer texels around it, the edge's past the drawn image), read as
 * four bilinear taps between texel pairs at a quarter of a texel (`radianceTent`): a smooth,
 * near-Gaussian chain, shift-free, whose B-spline read is a soft blob at every level, never a
 * texel's square. The colour is filtered with its coverage (the lit image's alpha: 1 where a surface
 * drew, 0 on the background, at most 1 at every level), which the reflection divides by, so a
 * footprint never darkens toward the background.
 *
 * Two levels a dispatch: a workgroup makes the tents of the level between for the `REFLECTION_SIDE`²
 * texels of the coarsest level, and of the texel of halo around them, in workgroup memory (each
 * once, its own threads' share, `radianceFill`), writes those it owns, and after one barrier each
 * thread sums the 4 × 4 of them around its texel (`radianceSum`). `radianceFirst` does so from the
 * drawn image, levels 1 and 2; `radianceDown` from each level after. The levels take four
 * dispatches of the drawn size's texels, plus a margin the footprints' reads reach
 * (`radianceThreads`). The image's 8 bytes a pixel are read once and the coarser levels written, a
 * third of it.
 */
const B = RADIANCE_BINDINGS
export const RADIANCE_SHADER = wgslProgram(
  `@group(0) @binding(${B.finer}) var finer:texture_2d<f32>;
@group(0) @binding(${B.coarser}) var coarser:texture_storage_2d<${HDR_FORMAT},write>;
@group(0) @binding(${B.coarsest}) var coarsest:texture_storage_2d<${HDR_FORMAT},write>;
@group(0) @binding(${B.halves}) var halves:sampler;
@group(0) @binding(${B.view}) var<uniform> view:View;
var<workgroup> tile:array<vec4f,${TILE * TILE}>;
fn tent(k:i32)->f32{return select(1.0,3.0,k==1||k==2);}
fn radianceTent(q:vec2i,bounds:vec2i)->vec4f{
 let size=vec2f(textureDimensions(finer));
 let last=vec2f(bounds-vec2i(1));
 let low=(clamp(vec2f(2*q)-vec2f(0.25),vec2f(0.0),last)+vec2f(0.5))/size;
 let high=(clamp(vec2f(2*q)+vec2f(1.25),vec2f(0.0),last)+vec2f(0.5))/size;
 let sum=textureSampleLevel(finer,halves,low,0.0)+textureSampleLevel(finer,halves,vec2f(high.x,low.y),0.0)
  +textureSampleLevel(finer,halves,vec2f(low.x,high.y),0.0)+textureSampleLevel(finer,halves,high,0.0);
 return vec4f(sum.rgb,min(sum.a,4.0))/4.0;
}
fn radianceFill(lane:u32,wg:vec2u,bounds:vec2i){
 let size=vec2i(textureDimensions(coarser));
 let origin=vec2i(wg)*${2 * REFLECTION_SIDE}-vec2i(1);
 for(var cell=lane;cell<${TILE * TILE}u;cell+=${REFLECTION_SIDE * REFLECTION_SIDE}u){
  let at=vec2i(i32(cell%${TILE}u),i32(cell/${TILE}u));
  let q=origin+at;
  let texel=radianceTent(clampToExtent(q,size),bounds);
  tile[cell]=texel;
  if(all(at>=vec2i(1))&&all(at<=vec2i(${2 * REFLECTION_SIDE}))&&all(q<size)){textureStore(coarser,q,texel);}
 }
}
fn radianceSum(lid:vec2u,wg:vec2u){
 var sum=vec4f(0.0);
 for(var j=0;j<4;j++){
  for(var i=0;i<4;i++){
   sum+=tent(i)*tent(j)*tile[(2*lid.y+u32(j))*${TILE}u+2*lid.x+u32(i)];
  }
 }
 let c=vec2i(wg*${REFLECTION_SIDE}u+lid);
 if(all(c<vec2i(textureDimensions(coarsest)))){textureStore(coarsest,c,sum/64.0);}
}
fn radianceLevels(lane:u32,wg:vec2u,lid:vec2u){
 radianceFill(lane,wg,vec2i(view.viewport.xy));
 workgroupBarrier();
 radianceSum(lid,wg);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn radianceFirst(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 radianceLevels(lane,wg.xy,lid.xy);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn radianceDown(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 radianceFill(lane,wg.xy,vec2i(textureDimensions(finer)));
 workgroupBarrier();
 radianceSum(lid.xy,wg.xy);
}`,
  [VIEW_WGSL, clampToExtent],
)
