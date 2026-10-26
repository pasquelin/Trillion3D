import { HIZ_BUILD_SIDE, HIZ_PASS_LEVELS, HIZ_UNI } from './uniforms.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslFn, type WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { surfaceSlopeOf } from '../../../../../math/src/wgsl/sampling.ts'
import {
  HIZ_CULL_FARTHEST,
  HIZ_FOLD_WGSL,
  HIZ_FORMAT,
  HIZ_NEAREST,
  HIZ_OPAQUE_LAYER,
  HIZ_TEXEL_WGSL,
  HIZ_WHOLE_FARTHEST,
} from './pyramidTexture.ts'

/** The override that makes `buildHiz` build the trace layers — the nearest and, where the planes are
 *  kept, the finished depth's farthest — in the same dispatches as the culling layer
 *  (`createHizPipelines`). */
export const HIZ_WITH_TRACE = 'HIZ_WITH_TRACE'
/** The pixels a plane's slopes reach on each side (`surfaceSlopeOf`: two neighbours), and the side
 *  of the full build's depth tile: a workgroup's pixels and that border. */
const HIZ_PLANE_REACH = 2
const HIZ_DEPTH_TILE = 2 * HIZ_BUILD_SIDE + 2 * HIZ_PLANE_REACH

/** The build's override, uniform, bindings and workgroup memory. */
const HIZ_BUILD_BINDINGS_TEXT = `override ${HIZ_WITH_TRACE}:bool=false;
${HIZ_UNI.wgsl}
@group(0) @binding(0) var hizPyramid:texture_storage_2d_array<${HIZ_FORMAT},read_write>;
@group(0) @binding(1) var level0:texture_2d_array<f32>;
@group(0) @binding(2) var<uniform> uni:Uni;
var<workgroup> hizTile:array<vec3f,${HIZ_BUILD_SIDE ** 2}>;
/** The folded depth of the full build's first pass over the workgroup's pixels and the border of
 *  two its planes reach (\`hizPlaneCorners\`), each texel loaded once; \`hizDepthOrigin\` the pixel
 *  of its first texel. */
var<workgroup> hizDepthTile:array<f32,${HIZ_DEPTH_TILE ** 2}>;
var<private> hizDepthOrigin:vec2i;
`

/** The build's reads and writes of the pyramid's words and bounds. */
const HIZ_BUILD_ACCESS_TEXT = `/** The index in \`layer\`'s bound of the cell at the index \`i\` the passes name (the culling layer's
 *  routing, \`hizRoute\`): a coarser level's cells lie after those of the layers before it. */
fn hizIn(i:u32,layer:u32)->u32{return select(i,i+layer*uni.upper,(i&HIZ_UPPER)!=0u);}
/** The word at index \`i\` of \`layer\`, as a depth; one written there. */
fn hizLoad(i:u32,layer:u32)->f32{let j=hizIn(i,layer);return bitcast<f32>(textureLoad(hizPyramid,hizTexel(j),hizSlice(j)).r);}
fn hizPut(i:u32,layer:u32,word:u32){let j=hizIn(i,layer);textureStore(hizPyramid,hizTexel(j),hizSlice(j),vec4u(word,0u,0u,0u));}
/** Whether the build keeps the planes (\`uni.planes\`): else the nearest layer is the closest depth at
 *  each pixel's centre and the finished depth's farthest layer is left unwritten. */
fn hizKeepsPlanes()->bool{return ${HIZ_WITH_TRACE}&&uni.planes!=0u;}
/** The triple of bounds at packed index \`i\`: the culling farthest, the nearest, and the finished
 *  depth's farthest (each zero where the build does not write it). */
fn hizLoadBound(i:u32)->vec3f{
 let cull=hizLoad(i,${HIZ_CULL_FARTHEST}u);
 if(!${HIZ_WITH_TRACE}){return vec3f(cull,0.0,0.0);}
 let nearest=hizLoad(i,${HIZ_NEAREST}u);
 if(hizKeepsPlanes()){return vec3f(cull,nearest,hizLoad(i,${HIZ_WHOLE_FARTHEST}u));}
 return vec3f(cull,nearest,0.0);
}
fn hizPutBound(i:u32,bound:vec3f){
 hizPut(i,${HIZ_CULL_FARTHEST}u,bitcast<u32>(bound.x));
 if(${HIZ_WITH_TRACE}){hizPut(i,${HIZ_NEAREST}u,bitcast<u32>(bound.y));}
 if(hizKeepsPlanes()){hizPut(i,${HIZ_WHOLE_FARTHEST}u,bitcast<u32>(bound.z));}
}
`

/** The trace layers' folded depth: its front depth, its workgroup tile. */
const HIZ_BUILD_DEPTH_TEXT = `/** The depth of the trace layers at \`q\`: the opaque depth, or the nearest transparent surface's
 *  (level 0's second layer, a depth a pixel, zero for none) where this image wrote it
 *  (\`uni.front\`) and it lies in front: reverse-Z, the larger. A pixel without one reads the opaque
 *  depth, bit for bit. */
fn hizFrontAt(q:vec2i)->f32{
 return hizFold(level0,q,uni.front!=0u);
}
/** Loads the folded depth of the workgroup \`wg\`'s tile, clamped to the drawn size, each thread a
 *  share of its texels: the nine texels a plane reads, of four pixels a thread, come from it. */
fn hizLoadDepthTile(wg:vec2u,thread:u32){
 hizDepthOrigin=vec2i(wg*${2 * HIZ_BUILD_SIDE}u)-vec2i(${HIZ_PLANE_REACH});
 let last=vec2i(vec2u(uni.b,uni.c))-vec2i(1);
 for(var k=thread;k<${HIZ_DEPTH_TILE ** 2}u;k+=${HIZ_BUILD_SIDE ** 2}u){
  let q=hizDepthOrigin+vec2i(i32(k%${HIZ_DEPTH_TILE}u),i32(k/${HIZ_DEPTH_TILE}u));
  hizDepthTile[k]=hizFrontAt(clamp(q,vec2i(0),last));
 }
}
/** The depth at \`q\` of level 0, clamped to the drawn size: the tile's texel. */
fn hizDepthAt(q:vec2i)->f32{
 let t=q-hizDepthOrigin;
 return hizDepthTile[t.y*${HIZ_DEPTH_TILE}+t.x];
}
`

/** The planes of the trace layers and the bounds of a pair and of a square. */
const HIZ_BUILD_BOUNDS_TEXT = `/** The nearest and the farthest corner of the plane of the pixel \`q\` of depth \`z\`, its slopes
 *  written at \`i\` of the nearest layer: relative to its depth, two halves; the corners from the
 *  halves the readers unpack (\`hizPlane\`), so that a level-1 bound holds every plane a reader
 *  sees, over the whole of its pixel — not only at its centre: a plane steeper than a slab is
 *  thick leaves the centre's depth behind at the pixel's far edge. */
fn hizPlaneCorners(i:u32,q:vec2i,z:f32)->vec2f{
 let x=vec2i(1,0);let y=vec2i(0,1);
 let slopes=vec2f(
  surfaceSlopeOf(z,hizDepthAt(q-x),hizDepthAt(q+x),hizDepthAt(q-x*2),hizDepthAt(q+x*2)),
  surfaceSlopeOf(z,hizDepthAt(q-y),hizDepthAt(q+y),hizDepthAt(q-y*2),hizDepthAt(q+y*2)));
 let word=pack2x16float(select(vec2f(0.0),slopes/z,z>0.0));
 hizPut(i,${HIZ_NEAREST}u,word);
 let s=unpack2x16float(word)*z;
 let half=0.5*(abs(s.x)+abs(s.y));
 return vec2f(z+half,max(z-half,0.0));
}
/** A texel of the pass's source level at \`at\`, its triple of bounds: when the source sits at offset
 *  zero, the level-0 texture read in place — nothing of it is copied; the opaque depth for the
 *  culling farthest, the folded depth or its plane's corners for the trace layers, the plane's
 *  slopes written into the nearest layer beside it —; else the level the previous pass wrote. */
fn hizSource(at:u32,x:u32,y:u32)->vec3f{
 let i=at+y*uni.b+x;
 if(uni.a!=0u){return hizLoadBound(i);}
 let q=vec2i(i32(x),i32(y));
 let cull=hizLevel0(textureLoad(level0,q,${HIZ_OPAQUE_LAYER},0).r);
 if(!${HIZ_WITH_TRACE}){return vec3f(cull,0.0,0.0);}
 if(hizKeepsPlanes()){
  let corners=hizPlaneCorners(i,q,hizDepthAt(q));
  return vec3f(cull,corners.x,corners.y);
 }
 return vec3f(cull,hizFrontAt(q),0.0);
}
/** The bounds of two triples: reverse-Z, the farthest is the MINIMUM, the nearest the MAXIMUM; the
 *  first and the last of a triple are always farthest. */
fn hizBound(a:vec3f,b:vec3f)->vec3f{
 return vec3f(min(a.x,b.x),max(a.y,b.y),min(a.z,b.z));
}
/** The first texel of the square of the cell \`cell\` over \`size\` texels: twice it, or, where the
 *  square is read from the depth itself (\`fromDepth\`, the first level's gather) and would be
 *  half of one at an odd edge, one texel back — the cell then holds the image's last two. */
fn hizSquareStart(cell:u32,size:u32,fromDepth:bool)->u32{
 return select(cell*2u,min(cell*2u,max(size,2u)-2u),fromDepth);
}
/** The bound of a 2 × 2 square read clamped to its level: the right column counts when \`dx\`
 *  is 1, the bottom row when \`dy\` is 1, in the order of the per-level reduction. */
fn hizBound4(v00:vec3f,v10:vec3f,v01:vec3f,v11:vec3f,dx:u32,dy:u32)->vec3f{
 var bound=v00;
 if(dx!=0u){bound=hizBound(bound,v10);}
 if(dy!=0u){
  bound=hizBound(bound,v01);
  if(dx!=0u){bound=hizBound(bound,v11);}
 }
 return bound;
}
`

/** The kernel: a pass's levels through workgroup memory. */
const HIZ_BUILD_KERNEL_TEXT = `@compute @workgroup_size(${HIZ_BUILD_SIDE}, ${HIZ_BUILD_SIDE})
fn buildHiz(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u){
 // uni: a the source level's index, b × c its size, d the levels this pass writes (dst), upper the
 // texels of the coarser levels of one bound (\`hizIn\`).
 let at=uni.a;
 let x=wg.x*${HIZ_BUILD_SIDE}u+lid.x;let y=wg.y*${HIZ_BUILD_SIDE}u+lid.y;let x0=hizSquareStart(x,uni.b,at==0u);let y0=hizSquareStart(y,uni.c,at==0u);
 if(hizKeepsPlanes()&&at==0u){
  hizLoadDepthTile(wg.xy,lid.y*${HIZ_BUILD_SIDE}u+lid.x);
  workgroupBarrier();
 }
 var bound=vec3f(0.0);
 if(x*2u<uni.b&&y*2u<uni.c){
  let dx=select(0u,1u,x0+1u<uni.b);let dy=select(0u,1u,y0+1u<uni.c);
  bound=hizBound4(hizSource(at,x0,y0),hizSource(at,x0+dx,y0),hizSource(at,x0,y0+dy),hizSource(at,x0+dx,y0+dy),dx,dy);
  if(uni.d>0u){hizPutBound(uni.dst[0].x+y*uni.dst[0].y+x,bound);}
 }
 hizTile[lid.y*${HIZ_BUILD_SIDE}u+lid.x]=bound;
 // Each further level halves the threads at work; the one the tile holds is read, then replaced.
 var side=${HIZ_BUILD_SIDE}u;
 for(var k=1u;k<min(uni.d,${HIZ_PASS_LEVELS}u);k++){
  side=side>>1u;
  workgroupBarrier();
  let src=uni.dst[k-1u];let dst=uni.dst[k];
  let tx=wg.x*side+lid.x;let ty=wg.y*side+lid.y;
  let live=lid.x<side&&lid.y<side&&tx<dst.y&&ty<dst.z;
  if(live){
   let i=lid.y*${2 * HIZ_BUILD_SIDE}u+lid.x*2u;
   let dx=select(0u,1u,tx*2u+1u<src.y);let dy=select(0u,1u,ty*2u+1u<src.z);
   bound=hizBound4(hizTile[i],hizTile[i+dx],hizTile[i+dy*${HIZ_BUILD_SIDE}u],hizTile[i+dy*${HIZ_BUILD_SIDE}u+dx],dx,dy);
  }
  workgroupBarrier();
  if(live){
   hizTile[lid.y*${HIZ_BUILD_SIDE}u+lid.x]=bound;
   hizPutBound(dst.x+ty*dst.y+tx,bound);
  }
 }
}
`

/**
 * THE DEPTH PYRAMID: the engine's one hierarchy of the image's depth, in one texture of two slices
 * (`pyramidTexture.ts`) at the packed indices of `pyramidBytes`, routed to the layers (`hizRoute`) — each level the ceiling half of
 * the one before it, so a texel of level `l` covers the pixels `[x·2^l, (x+1)·2^l)` of the
 * image, clipped to it; level 1's gather of 2 × 2 pixels never reads past the image, so at an odd
 * edge its last texel holds the last two pixels, one back (`hizSquareStart`), and the coarser
 * levels' last texels with it. Reverse-Z throughout. The pyramid starts at half resolution: level 1 is
 * the first mip, reduced from the depth texture itself, and no layer keeps a copy of the depth
 * as its level 0 (the readers that need a pixel's own depth read the depth texture).
 *
 *  - the CULLING FARTHEST layer, levels 1 and up: each texel the farthest — the MINIMUM — of the
 *    four below it, from the opaque depth alone. Built mid-frame (`encodePyramid`) from the depth the cut's
 *    main pass drew, the only depth there is before its post pass tests the rest, then again from
 *    the whole depth for the next image's main pass. The depth only comes nearer after a build, so
 *    what hides a box there hides it in the finished image, and a cell's farthest there is at or
 *    behind the finished one's: a bound every reader can trust. The cut's occlusion test
 *    (`../../../geometry/dag/shader/occlusionWgsl.ts`) and the transparent test read it.
 *  - the WHOLE-DEPTH FARTHEST layer, levels 1 and up: the same reduction of the FINISHED depth's
 *    planes — the farthest corner of each pixel's plane (`hizPlaneCorners`), so that it holds the
 *    whole of every pixel, not its centre alone —, built in the same pass and by the same kernel
 *    as the nearest layer (`encodeFull`). The occluders'
 *    depth is the farthest of two images of the same pixel, so its farthest is behind this one's,
 *    and a bound that says a cell lies entirely in front of a ray needs the finished image's.
 *  - the NEAREST layer: level 0 each pixel's plane through its depth — its two slopes in depth per
 *    pixel, the slope rule of every depth reader (`surfaceSlopeOf`), relative to its depth so
 *    that two halves keep them at every distance —, each coarser texel the nearest — the MAXIMUM —
 *    of the four below it, level 1 of the nearest corner of each pixel's plane, half the slopes'
 *    sum in front of its depth. Built with the culling layer once the whole depth is drawn
 *    (`encodeFull`), for the
 *    readers of the whole depth (`hizDepthWgsl`): a cell's two bounds, its plane at a pixel. Both
 *    reduce the depth with the nearest transparent surface's folded in (level 0's second layer,
 *    `Pyramid.frontView`) where the setting `hizFoldTransparents` asks for it (`uni.front`, off
 *    by default): the one pyramid then holds every surface a ray can meet.
 *  - the setting `hizTrace` `'reference'`, the default (`uni.planes` zero, `GpuHiz.planes`), builds
 *    the NEAREST layer another way: its level 1 and up the closest — the MAXIMUM — of the depths of
 *    the pixels' centres under a texel, no slope, no corner, and the whole-depth farthest layer
 *    left unwritten and unread: the closest pyramid the reference's walk reads
 *    (`screenMarchReference.ts`), one read of the depth a pixel and no tile of workgroup memory.
 *
 * Per image of N pixels, M = N/3 the words of the levels from 1 up: the culling build reads the
 * depth once and writes M words; the full build (`HIZ_WITH_TRACE`) reads it once and writes the
 * culling M, the nearest M and — with the planes kept, each workgroup loading its pixels and their border of
 * `HIZ_PLANE_REACH` into workgroup memory, where each plane reads its nine texels — the finished
 * depth's farthest M and the N words of the slopes; the texture holds 2N words, padded to a
 * whole row of `HIZ_ROW`.
 *
 * Both are one kernel, `buildHiz`, specialized by `HIZ_WITH_TRACE`; it reduces a triple of
 * bounds, the culling farthest, the nearest and the finished depth's farthest (the first alone in
 * the culling build). It reduces
 * `HIZ_PASS_LEVELS` mips per dispatch through workgroup memory: each thread reads one 2 × 2
 * square of the source level and the workgroup reduces its 8 × 8 results down to one texel, each
 * level the bound of four taken in the same order as a per-level reduction, so every mip holds the
 * same value. The first pass reads the depth texture itself, reducing level 1 straight from it
 * (the planes' slopes are the only level-0 words it writes).
 *
 * The level-0 depth is read through `hizLevel0`, declared by `level0`: the image's own build reads it as
 * the image wrote it (`HIZ_LEVEL0_WGSL`), the primed pyramid's pushes it away (`primedWgsl.ts`).
 */
export const hizBuildShader = (level0: WgslDecl) =>
  wgslProgram(
    `${HIZ_BUILD_BINDINGS_TEXT}${HIZ_BUILD_ACCESS_TEXT}${HIZ_BUILD_DEPTH_TEXT}${HIZ_BUILD_BOUNDS_TEXT}${HIZ_BUILD_KERNEL_TEXT}`,
    [HIZ_TEXEL_WGSL, HIZ_FOLD_WGSL, surfaceSlopeOf, level0],
  )

/** The image's own level-0 depth, as the image wrote it. */
const HIZ_LEVEL0_WGSL = wgslFn('hizLevel0', [], 'fn hizLevel0(z:f32)->f32{return z;}')

/** The build of the image's own pyramid, which no setting changes. */
export const HIZ_SHADER = /* @__PURE__ */ hizBuildShader(HIZ_LEVEL0_WGSL)
