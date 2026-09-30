import { COVERAGE_CUT_WGSL, COVERAGE_PICK_WGSL, COVERAGE_SCALE_WGSL } from './coverageRule.ts';
import { RADIANCE_REDUCTION_WGSL } from './radianceReduction.ts';

// The mip chain's kernels: the reduction of one level (`mips.ts`) and the coverage counts of a
// coverage chain (`coverageMips.ts`).

/**
 * Colours are averaged, alpha is the MEDIAN of the four texels — never their mean.
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
 * `extent` is the source's size, then a coverage chain's cutoff byte `C` and the level's `t`: with
 * `C`, the median byte is scaled to keep level 0's coverage (`coverageMips.ts`); without, the
 * median stays as it was, byte for byte.
 */
const MIP_SHADER = `
 @group(0) @binding(0) var source:texture_2d<f32>;
 @group(0) @binding(1) var<uniform> extent:vec4u;
 override weighted:bool;
 override radiance:bool=false;
 override bounds:bool=false;
 fn mipRead(p:vec2i)->vec4f{return textureLoad(source,p,0);}
 ${RADIANCE_REDUCTION_WGSL}
 ${COVERAGE_SCALE_WGSL}
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
  return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);
 }
 @fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f{
  if(radiance){return radianceReduction(vec2i(pos.xy));}
  let p=vec2i(pos.xy)*2;let hi=vec2i(extent.xy)-vec2i(1);
  let s0=mipRead(min(p,hi));let s1=mipRead(min(p+vec2i(1,0),hi));
  let s2=mipRead(min(p+vec2i(0,1),hi));let s3=mipRead(min(p+vec2i(1,1),hi));
  let mean=(s0+s1+s2+s3)*0.25;
  let a=vec4f(s0.w,s1.w,s2.w,s3.w);
  let byAlpha=(s0.rgb*s0.w+s1.rgb*s1.w+s2.rgb*s2.w+s3.rgb*s3.w)/dot(a,vec4f(1.0));
  return vec4f(select(mean.rgb,byAlpha,weighted&&any(a!=vec4f(s0.w))),reducedAlpha(a,extent.z,extent.w));
 }`;

/** Source variants share the runtime constructor with the shader manifest. */
export const mipShader = (depth: boolean) =>
  depth
    ? MIP_SHADER.replace('source:texture_2d<f32>', 'source:texture_depth_2d').replace(
        'return textureLoad(source,p,0);',
        'let z=textureLoad(source,p,0);return select(vec4f(z,z,0.0,1.0),vec4f(1.0,0.0,0.0,0.0),z==0.0);',
      )
    : MIP_SHADER;

/**
 * The counts of the coverage rule (docs/FORMAT.md, "Coverage-preserving alpha"): `count` files the
 * four filtered samples of each texel's square (`cutBin`) — its alpha bytes level 0's own, a
 * level's medians from the one above — in its level's 256 bins, through a workgroup's own 256;
 * `choose` then picks that level's `t`, one thread, and leaves it in bin 0, which it never reads
 * (`t >= 1`). `level`: the source's extent, `C`, `t`, then level
 * 0's extent and the level. A texel's square reads its neighbours' alphas: the workgroup reads its
 * 9×9 alphas once into its own memory, not four times each (OMB-29, #961) — the same alphas,
 * clamped at the edge as before, so the same bins.
 */
export const COVERAGE_WGSL = `
 @group(0) @binding(0) var source:texture_2d<f32>;
 struct Level{extent:vec4u,base:vec4u}
 @group(0) @binding(1) var<uniform> level:Level;
 @group(0) @binding(2) var<storage,read_write> cover:array<atomic<u32>>;
 fn binOf(t:u32)->u32{return atomicLoad(&cover[level.base.z*256u+t]);}
 ${COVERAGE_SCALE_WGSL}
 ${COVERAGE_PICK_WGSL}
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
 }
 @compute @workgroup_size(1) fn choose(){
  let c=level.extent.z;var covered=0u;
  for(var b=c;b<256u;b++){covered+=atomicLoad(&cover[b]);}
  let n0=sizeOf(0u);let nk=sizeOf(level.base.z);
  atomicStore(&cover[level.base.z*256u],pick(c,covered,vec2u(n0.x*n0.y,nk.x*nk.y)));
 }`;
