import { FULLSCREEN_XY_WGSL } from '../gpu/shader/fullscreenTriangle.ts'
import { COVERAGE_CUT_WGSL, COVERAGE_PICK_WGSL, COVERAGE_SCALE_WGSL } from './coverageRule.ts'
import { cellReductionWgsl } from './cellReduction.ts'
import { SRGB_ENCODE_WGSL } from './srgbEncode.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'

// The mip chains' kernels: the reduction of a material level and the coverage counts of a
// coverage chain (`mipBatch.ts`, `coverageMips.ts`), and a reflection's radiance reduction.

/** A material level's uniform block, the counts' as well: the source level's extent, the cutoff
 *  byte `C`, then level 0's extent and the level. */
const LEVEL_WGSL = ` struct Level{extent:vec4u,base:vec4u}
 @group(0) @binding(1) var<uniform> level:Level;`

/**
 * One level of a material chain from the one above, one thread a texel, the whole chain one
 * compute pass (`generateMaterialMips`). Colours are averaged, alpha is the MEDIAN of the four
 * texels — never their mean.
 *
 * Alpha of a foliage map is not a colour: it is what a masked material compares to its threshold.
 * A mean pulls each level toward the map's mean alpha; above the threshold, the silhouette grows
 * from one level to the next until the whole quad passes the test, loses its holes and combs into
 * an opaque rectangle in front of what is behind — which loading used to make visible, since the
 * cutout then reads the finest RESIDENT level, therefore a coarse level.
 *
 * The median of four values, itself, passes a GIVEN threshold exactly when two of the four texels
 * pass it: the coarse texel is kept when half of what it covers was, and threshold coverage is
 * preserved from one level to the next without depending on the threshold. That is what makes it
 * applicable here: the threshold belongs to the material, the mip chain to a texture several
 * materials share, and nothing at this place knows which threshold will be applied to it.
 *
 * Sorted decreasing, the median is the mean of the two middle values: `u` is the second, `v` the
 * third, six comparisons with neither a sort nor a branch (`reducedAlpha`, `coverageRule.ts`).
 *
 * Under `weighted`, four texels whose alphas differ average their colours
 * weighted by alpha, and `select` keeps the plain mean everywhere else, byte for byte: the rule the
 * compiler bakes, and its reasons (`packages/asset-compiler-rust/src/texture_preview/reduce.rs`,
 * `halve`, #42).
 *
 * With a cutoff `C`, the median byte is scaled by the level's `t`, which the counts' pick left in
 * bin 0 of the level's bins (`COVERAGE_CHOOSE_WGSL`) — read there, never copied — to keep level 0's
 * coverage (`coverageMips.ts`); without, the median stays as it was, byte for byte. A colour level
 * is read decoded through its sRGB view and averaged in linear light; an sRGB format has no
 * storage binding, so `srgb` encodes it again (`linearToSrgb`) into the `rgba8unorm` storage view.
 */
export const MATERIAL_MIP_WGSL = `
 @group(0) @binding(0) var source:texture_2d<f32>;
${LEVEL_WGSL}
 @group(0) @binding(2) var<storage,read> cover:array<u32>;
 @group(0) @binding(3) var written:texture_storage_2d<rgba8unorm,write>;
 override weighted:bool;
 override srgb:bool;
 ${COVERAGE_SCALE_WGSL}
 ${SRGB_ENCODE_WGSL}
 @compute @workgroup_size(8,8) fn reduceLevel(@builtin(global_invocation_id) id:vec3u){
  if(any(id.xy>=textureDimensions(written))){return;}
  let p=vec2i(id.xy)*2;let hi=vec2i(level.extent.xy)-vec2i(1);
  let s0=textureLoad(source,min(p,hi),0);let s1=textureLoad(source,min(p+vec2i(1,0),hi),0);
  let s2=textureLoad(source,min(p+vec2i(0,1),hi),0);let s3=textureLoad(source,min(p+vec2i(1,1),hi),0);
  let mean=(s0+s1+s2+s3)*0.25;
  let a=vec4f(s0.w,s1.w,s2.w,s3.w);
  let byAlpha=(s0.rgb*s0.w+s1.rgb*s1.w+s2.rgb*s2.w+s3.rgb*s3.w)/dot(a,vec4f(1.0));
  var rgb=select(mean.rgb,byAlpha,weighted&&any(a!=vec4f(s0.w)));
  if(srgb){rgb=linearToSrgb(rgb);}
  let c=level.extent.z;var t=0u;
  if(c!=0u){t=cover[level.base.z*256u];}
  textureStore(written,vec2i(id.xy),vec4f(rgb,reducedAlpha(a,c,t)));
 }`

/** A reflection's radiance level from the one above (`cellReduction`, `cellReduction.ts`), drawn
 *  into the level: its source is the frame's render target, kept free of storage usage. `extent`
 *  is the source level's size, then the image's. */
export const RADIANCE_MIP_WGSL = `
 @group(0) @binding(0) var source:texture_2d<f32>;
 @group(0) @binding(1) var<uniform> extent:vec4u;
 fn mipRead(p:vec2i)->vec4f{return textureLoad(source,p,0);}
 ${cellReductionWgsl(false)}
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
  return vec4f(${FULLSCREEN_XY_WGSL},0.0,1.0);
 }
 @fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f{return cellReduction(vec2i(pos.xy));}`

/**
 * The counts of the coverage rule (docs/FORMAT.md, "Coverage-preserving alpha"): `count` files the
 * four filtered samples of each texel's square (`cutBin`) — its alpha bytes level 0's own, a
 * level's medians from the one above — in its level's 256 bins, through a workgroup's own 256;
 * `COVERAGE_CHOOSE_WGSL` then picks that level's `t`. `level`: the block `LEVEL_WGSL` names. A
 * texel's square reads its neighbours' alphas: the workgroup reads its 9×9 alphas once into its own
 * memory, not four times each (OMB-29, #961) — the same alphas, clamped at the edge as before, so
 * the same bins.
 */
export const COVERAGE_WGSL = `
 @group(0) @binding(0) var source:texture_2d<f32>;
${LEVEL_WGSL}
 @group(0) @binding(2) var<storage,read_write> cover:array<atomic<u32>>;
 ${COVERAGE_SCALE_WGSL}
 ${COVERAGE_CUT_WGSL}
 fn sizeOf(k:u32)->vec2u{return max(level.base.xy>>vec2u(k),vec2u(1u));}
 fn alphaAt(q:vec2u)->u32{
  let k=level.base.z;let p=vec2i(min(q,sizeOf(k)-vec2u(1u)));
  if(k==0u){return toByte(textureLoad(source,p,0).w);}
  let s=p*2;let hi=vec2i(level.extent.xy)-vec2i(1);
  return median(vec4f(textureLoad(source,min(s,hi),0).w,textureLoad(source,min(s+vec2i(1,0),hi),0).w,
   textureLoad(source,min(s+vec2i(0,1),hi),0).w,textureLoad(source,min(s+vec2i(1,1),hi),0).w));
 }
 var<workgroup> tally:array<atomic<u32>,256>;
 var<workgroup> alphas:array<u32,81>;
 @compute @workgroup_size(8,8) fn count(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) i:u32,@builtin(workgroup_id) g:vec3u){
  let k=level.base.z;let o=g.xy*8u;
  for(var j=i;j<81u;j+=64u){alphas[j]=alphaAt(o+vec2u(j%9u,j/9u));}
  workgroupBarrier();
  if(all(id.xy<sizeOf(k))){
   let j=(id.y-o.y)*9u+id.x-o.x;
   let a=vec4u(alphas[j],alphas[j+1u],alphas[j+9u],alphas[j+10u]);
   for(var s=0u;s<4u;s++){atomicAdd(&tally[cutBin(a,s,level.extent.z)],1u);}
  }
  // Foliage lands nearly every texel in two bins: the workgroup counts apart, then adds its own
  // bins once each, not one device atomic per texel on the same two words.
  workgroupBarrier();
  for(var b=i;b<256u;b+=64u){let n=atomicLoad(&tally[b]);if(n>0u){atomicAdd(&cover[k*256u+b],n);}}
 }`

/**
 * The picks of one level of a batch, one workgroup a cutting chain (`mipBatch.ts`), one dispatch
 * for them all. `pick`: the level, the table's first word, the words a
 * block and the chains reaching the level; `blocks`: the batch's uniform words — each chain's
 * level blocks (`LEVEL_WGSL`, word 3 its first bin word), then the table, a cutting chain's first
 * block and levels, those reaching the level first. One lane a
 * byte `t`: level 0's covered count is the sum of its bins at and past the cutoff, `above` the
 * level's bins from `t` up (a suffix scan), each lane's `pickKey`, and the least key of lanes 1 to
 * 255 is the pick — keys differ by `t`, so the least is the serial loop's, whatever the order —,
 * left in bin 0, which no key reads, where the level's reduction reads it. Integers only: the
 * same `t` as one thread looping over the bins.
 */
export const COVERAGE_CHOOSE_WGSL = `
 struct Pick{level:u32,table:u32,words:u32,count:u32}
 @group(0) @binding(0) var<uniform> pick:Pick;
 @group(0) @binding(1) var<storage,read> blocks:array<u32>;
 @group(0) @binding(2) var<storage,read_write> cover:array<u32>;
 ${COVERAGE_PICK_WGSL}${FLAT_INDEX_WGSL}
 var<workgroup> sums:array<u32,256>;
 var<workgroup> keys:array<vec4u,256>;
 fn total(t:u32,v:u32)->u32{
  sums[t]=v;
  for(var half=128u;half>0u;half>>=1u){workgroupBarrier();if(t<half){sums[t]+=sums[t+half];}}
  workgroupBarrier();
  return sums[0];
 }
 fn fromHere(t:u32,v:u32)->u32{
  sums[t]=v;
  for(var d=1u;d<256u;d<<=1u){
   workgroupBarrier();
   let next=select(0u,sums[min(t+d,255u)],t+d<256u);
   workgroupBarrier();
   sums[t]+=next;
  }
  workgroupBarrier();
  return sums[t];
 }
 @compute @workgroup_size(256) fn choose(@builtin(local_invocation_index) t:u32,@builtin(workgroup_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
  // A group of the last row past the cutting chains has none.
  let chain=flatIndex(g,n,1u);if(chain>=pick.count){return;}
  let block=(blocks[pick.table+2u*chain]+pick.level)*pick.words;
  let c=blocks[block+2u];let bins=blocks[block+3u];
  let n0=vec2u(blocks[block+4u],blocks[block+5u]);let nk=max(n0>>vec2u(pick.level),vec2u(1u));
  let here=bins+pick.level*256u;
  let covered=total(t,select(0u,cover[bins+t],t>=c));
  workgroupBarrier();
  let above=fromHere(t,select(cover[here+t],0u,t==0u));
  let texels=vec2u(n0.x*n0.y,nk.x*nk.y);
  keys[t]=select(pickKey(c,t,above,texels,wide(covered,texels.y)),vec4u(0xffffffffu,0xffffffffu,255u,c),t==0u);
  for(var half=128u;half>0u;half>>=1u){
   workgroupBarrier();
   if(t<half&&below(keys[t+half],keys[t])){keys[t]=keys[t+half];}
  }
  if(t==0u){cover[here]=keys[0].w;}
 }`
