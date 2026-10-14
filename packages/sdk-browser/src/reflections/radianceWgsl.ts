import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { GOLDEN_U32 } from '../../../math/src/wgsl/constants.ts'
import { mixWord } from '../../../math/src/wgsl/sampling.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { VIEW_WGSL } from '../lighting/deferred/worldAtWgsl.ts'

/** Texels of a level one workgroup makes of the level two finer: `REFLECTION_SIDE`, each reading
 *  the four texels of the level between that surround it — a tile of `2 · REFLECTION_SIDE` and a
 *  texel of halo each side. */
const TILE = 2 * REFLECTION_SIDE + 2

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
 *
 * The first dispatch of an image drawn from where the one before it was (`HeldImage.still`) also
 * folds the image into a 64-bit hash (`radianceHash`, two words of a sum of the texels' mixes,
 * which no order of the threads changes), of the 4 × 4 pixels each thread owns: each thread sums
 * its texels' words, a workgroup adds its threads' by atomics of its own memory and one thread of
 * it adds the workgroup's to the hash of the image (`hash`); `radianceRoll` first moves the last
 * image's to the words beside (`settle.ts`). Only such an image can find the view settled
 * (`reflectionsSettled`), so a moving image hashes nothing (`radianceFirst`), and the still image
 * after it (`radianceFirstBoth`) hashes the image before it too, still whole as its level 0: the
 * two words beside hold what that image would have hashed, the very words, and the view settles on
 * the same image as when every image hashed.
 */
export const RADIANCE_SHADER = wgslProgram(
  `@group(0) @binding(0) var finer:texture_2d<f32>;
@group(0) @binding(1) var coarser:texture_storage_2d<${HDR_FORMAT},write>;
@group(0) @binding(2) var coarsest:texture_storage_2d<${HDR_FORMAT},write>;
@group(0) @binding(3) var halves:sampler;
@group(0) @binding(4) var previous:texture_2d<f32>;
@group(0) @binding(5) var<uniform> view:View;
@group(0) @binding(6) var<storage,read_write> hash:array<atomic<u32>>;
var<workgroup> tile:array<vec4f,${TILE * TILE}>;
var<workgroup> folded:array<atomic<u32>,4>;
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
  let texel=radianceTent(clamp(q,vec2i(0),size-vec2i(1)),bounds);
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
fn radianceHash(p:vec2i,texel:vec4f)->vec2u{
 let bits=bitcast<vec4u>(texel);
 let lo=mixWord(bits.x^mixWord(bits.y^mixWord(bits.z^mixWord(bits.w^(u32(p.x)*0x27d4eb2fu+u32(p.y)*0x165667b1u)))));
 return vec2u(lo,mixWord(lo^GOLDEN_U32));
}
fn radianceFold(image:texture_2d<f32>,c:vec2i)->vec2u{
 let size=vec2i(textureDimensions(image));
 let bounds=vec2i(view.viewport.xy);
 var sum=vec2u(0u);
 for(var y=0;y<4;y++){
  for(var x=0;x<4;x++){
   let p=4*c+vec2i(x,y);
   if(all(p<size)&&all(p<bounds)){
    let texel=textureLoad(image,p,0);
    sum+=radianceHash(p,vec4f(texel.rgb,clamp(texel.a,0.0,1.0)));
   }
  }
 }
 return sum;
}
fn radianceAdd(at:u32,sum:vec2u){
 atomicAdd(&folded[at],sum.x);
 atomicAdd(&folded[at+1u],sum.y);
}
fn radianceFlush(lane:u32,at:u32){
 if(lane==0u){
  atomicAdd(&hash[at],atomicLoad(&folded[at]));
  atomicAdd(&hash[at+1u],atomicLoad(&folded[at+1u]));
 }
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
fn radianceFirstHashed(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 radianceLevels(lane,wg.xy,lid.xy);
 radianceAdd(0u,radianceFold(finer,vec2i(wg.xy*${REFLECTION_SIDE}u+lid.xy)));
 workgroupBarrier();
 radianceFlush(lane,0u);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn radianceFirstBoth(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 radianceLevels(lane,wg.xy,lid.xy);
 let c=vec2i(wg.xy*${REFLECTION_SIDE}u+lid.xy);
 radianceAdd(0u,radianceFold(finer,c));
 radianceAdd(2u,radianceFold(previous,c));
 workgroupBarrier();
 radianceFlush(lane,0u);
 radianceFlush(lane,2u);
}
@compute @workgroup_size(1)
fn radianceRoll(){
 atomicStore(&hash[2],atomicLoad(&hash[0]));
 atomicStore(&hash[3],atomicLoad(&hash[1]));
 atomicStore(&hash[0],0u);
 atomicStore(&hash[1],0u);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn radianceDown(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 radianceFill(lane,wg.xy,vec2i(textureDimensions(finer)));
 workgroupBarrier();
 radianceSum(lid.xy,wg.xy);
}`,
  [VIEW_WGSL, mixWord, GOLDEN_U32],
)
