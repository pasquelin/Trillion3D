import {
  COMPUTE,
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../core/computeBindings.ts'
import {
  STATE_TALLY_WGSL,
  ST_REJECTED,
  ST_REJECTED_TRIANGLES,
  ST_TESTED,
  VERDICT_KEPT,
  VERDICT_REJECTED,
} from '../partition/contract.ts'
import { HIZ_HIDES_WGSL } from './rectWgsl.ts'
import { HIZ_BUILD_SIDE as S, HIZ_PASS_LEVELS } from './uniforms.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { FLAT_INDEX_WGSL, GROUP_GRID_WGSL } from '../dispatch/grid.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { ceilDiv } from '../../../../math/src/wgsl/integer.ts'
import { SURFACE_SLOPE_WGSL } from '../../lighting/deferred/footprintWgsl.ts'
import {
  HIZ_CULL_FARTHEST,
  HIZ_FORMAT,
  HIZ_NEAREST,
  HIZ_TEXEL_WGSL,
  HIZ_WHOLE_FARTHEST,
} from './pyramidTexture.ts'

/**
 * Group-0 bindings, published under the WGSL that declares them. The production layout and the
 * GPU proofs READ them here — none copies them, so none can lag behind the shader. That lag is
 * what turned the Hi-Z occlusion proof (`tests/gpu/hiz/occlusion-test.gpu.ts`) red: its copy had
 * stopped at `@binding(4)` while `state` entered at 5.
 */
export function hizBindEntries(uniformBytes: number): GPUBindGroupLayoutEntry[] {
  return [
    {
      binding: 0,
      visibility: COMPUTE,
      storageTexture: { access: 'read-write', format: HIZ_FORMAT, viewDimension: '2d-array' },
    },
    computeTextureEntry(1, 'unfilterable-float'),
    computeUniformEntry(2, { hasDynamicOffset: true, minBindingSize: uniformBytes }),
    computeBufferEntry(3, 'read-only-storage'),
    computeBufferEntry(4, 'storage'),
    computeBufferEntry(5, 'storage'),
  ]
}

/** Group 1, the test's alone: the page table, whose Hi-Z slot word tells a row that has no
 *  verdict (never culled). The pyramid kernels bind group 0 only. */
export const HIZ_TEST_PAGES_ENTRIES: GPUBindGroupLayoutEntry[] = [
  computeBufferEntry(0, 'read-only-storage'),
]

/** Group 1 of `testHizArgs`, beside the page table of `testHiz` (binding 0): the test's dispatch
 *  arguments, written there and read as the indirect arguments of `testHiz`. The group is set for
 *  the kernel that writes them and replaced by the page table before the dispatch that reads them:
 *  an arguments buffer bound as storage in the dispatch it feeds is refused. */
export const HIZ_TEST_ARGS_ENTRIES: GPUBindGroupLayoutEntry[] = [computeBufferEntry(1, 'storage')]

/** Threads of the test's workgroup. */
const HIZ_TEST_WORKGROUP = 64

/** Bytes of the test's dispatch arguments. */
export const HIZ_TEST_ARGS_BYTES = 12

/** The override that makes `buildHiz` the build of the nearest layer (`createHizPipelines`). */
export const HIZ_NEAREST_BUILD = 'HIZ_NEAREST_BUILD'

/**
 * THE DEPTH PYRAMID: the engine's one hierarchy of the image's depth, in one texture of three layers
 * (`pyramidTexture.ts`) at the packed indices of `pyramidBytes`, routed to the layers (`hizRoute`) — each level the ceiling half of
 * the one before it, so a texel of level `l` covers exactly the pixels `[x·2^l, (x+1)·2^l)` of the
 * image, clipped to it. Reverse-Z throughout.
 *
 *  - the CULLING FARTHEST layer: level 0 a copy of the depth, each coarser texel the farthest — the
 *    MINIMUM — of the four below it. Built mid-frame (`encodePyramid`) from the depth the
 *    occluders drew, the only depth there is before the test of the rest — an image that tests
 *    nothing builds it from its whole depth. The depth only comes nearer after it, so what hides a
 *    box there hides it in the finished image, and a cell's farthest there is at or behind the
 *    finished one's: a bound every reader can trust. The occlusion test below, the partition's
 *    main-pass cull and the transparent test read it; the readers of the whole depth read its
 *    coarser levels, and level 0 in its own texture, which then holds the depth whole.
 *  - the WHOLE-DEPTH FARTHEST layer, levels 1 and up: the same reduction of the FINISHED depth, built
 *    in the same pass and by the same kernel as the nearest layer (`encodeNearest`). The occluders'
 *    depth is the farthest of two images of the same pixel, so its farthest is behind this one's,
 *    and a bound that says a cell lies entirely in front of a ray needs the finished image's.
 *  - the NEAREST layer: level 0 each pixel's plane through its depth — its two slopes in depth per
 *    pixel, the slope rule of every depth reader (`surfaceSlopeOf`), relative to its depth so
 *    that two halves keep them at every distance —, each coarser texel the nearest — the MAXIMUM —
 *    of the four below it, level 1 of the nearest corner of each pixel's plane, half the slopes'
 *    sum in front of its depth. Built once the whole depth is drawn (`encodeNearest`), for the
 *    readers of the whole depth (`hizDepthWgsl`): a cell's two bounds, its plane at a pixel.
 *
 * Per image of N pixels: the culling build reads level 0 once and writes 4N/3 words, the nearest
 * reads nine texels of level 0 a pixel — its plane's neighbours, cached — and writes 4N/3 words
 * of its layer and N/3 of the finished depth's farthest; the texture holds 3N words, padded to a
 * whole row of `HIZ_ROW`.
 *
 * Both are one kernel, `buildHiz`, specialized by `HIZ_NEAREST_BUILD`; it reduces a pair of
 * bounds, the layer's own and the farthest of the depth (the same one in the culling build, which
 * writes only the first). It reduces
 * `HIZ_PASS_LEVELS` mips per dispatch through workgroup memory: each thread reads one 2 × 2
 * square of the source level and the workgroup reduces its 8 × 8 results down to one texel, each
 * level the bound of four taken in the same order as a per-level reduction, so every mip holds the
 * same value. The first pass reads the level-0 texture itself: the farthest build copies each
 * texel into the pyramid — the tests and the next image's cull read level 0 there —, the nearest
 * build writes each pixel's slopes, and both reduce level 1 from the texels they just read, never
 * rereading the copy.
 *
 * The test receives no count or bytes from the CPU: it reads the box count and writes its own
 * reject counters into the state the GPU partition holds, and the boxes are those the partition
 * packed in the same submission. No value is inferred there: a verdict is written, or the row
 * stays at zero.
 */
export const HIZ_SHADER = wgslProgram(
  `override ${HIZ_NEAREST_BUILD}:bool=false;
struct Uni{a:u32,b:u32,c:u32,d:u32,upper:u32,counting:u32,pad1:u32,pad2:u32,dst:array<vec4u,${HIZ_PASS_LEVELS}>,}
struct Bounds{minX:i32,minY:i32,maxX:i32,maxY:i32,nearest:f32,rowAndClip:u32,fineOffset:u32,fineWidth:u32,triangles:u32,coarseOffset:u32,coarseWidth:u32,coarseShift:u32,}
@group(0) @binding(0) var hizPyramid:texture_storage_2d_array<${HIZ_FORMAT},read_write>;
@group(0) @binding(1) var level0:texture_2d<f32>;
@group(0) @binding(2) var<uniform> uni:Uni;
@group(0) @binding(3) var<storage, read> bounds:array<Bounds>;
@group(0) @binding(4) var<storage, read_write> flags:array<u32>;
@group(0) @binding(5) var<storage, read_write> state:array<atomic<u32>>;
@group(1) @binding(0) var<storage, read> pages:array<PageInfo>;
@group(1) @binding(1) var<storage, read_write> testArgs:array<u32>;
var<workgroup> hizTile:array<vec2f,${S ** 2}>;
/** The index in \`layer\`'s bound of the cell at the index \`i\` the passes name (the culling layer's
 *  routing, \`hizRoute\`): a coarser level's cells lie after those of the layers before it. */
fn hizIn(i:u32,layer:u32)->u32{return select(i,i+layer*uni.upper,(i&HIZ_UPPER)!=0u);}
/** The word at index \`i\` of \`layer\`, as a depth; one written there. */
fn hizLoad(i:u32,layer:u32)->f32{let j=hizIn(i,layer);return bitcast<f32>(textureLoad(hizPyramid,hizTexel(j),hizSlice(j,layer)).r);}
fn hizPut(i:u32,layer:u32,word:u32){let j=hizIn(i,layer);textureStore(hizPyramid,hizTexel(j),hizSlice(j,layer),vec4u(word,0u,0u,0u));}
/** What the test reads (\`pyramidHides\`): the culling farthest layer. */
fn hizCullFarthest(i:u32)->f32{return hizLoad(i,${HIZ_CULL_FARTHEST}u);}
/** The layer this build writes, besides the finished depth's farthest in the nearest build. */
fn hizLayer()->u32{return select(${HIZ_CULL_FARTHEST}u,${HIZ_NEAREST}u,${HIZ_NEAREST_BUILD});}
/** The pair of bounds at packed index \`i\`: the layer's, and the finished depth's farthest. */
fn hizLoadBound(i:u32)->vec2f{
 let own=hizLoad(i,hizLayer());
 return vec2f(own,select(own,hizLoad(i,${HIZ_WHOLE_FARTHEST}u),${HIZ_NEAREST_BUILD}));
}
fn hizPutBound(i:u32,bound:vec2f){
 hizPut(i,hizLayer(),bitcast<u32>(bound.x));
 if(${HIZ_NEAREST_BUILD}){hizPut(i,${HIZ_WHOLE_FARTHEST}u,bitcast<u32>(bound.y));}
}
/** The depth at \`q\` of level 0, clamped to the drawn size. */
fn hizDepthAt(q:vec2i)->f32{
 return textureLoad(level0,clamp(q,vec2i(0),vec2i(vec2u(uni.b,uni.c))-vec2i(1)),0).r;
}
/** The nearest corner of the plane of the pixel \`q\` of depth \`z\`, its slopes written at \`i\`
 *  of the nearest layer: relative to its depth, two halves; the corner from the halves the readers
 *  unpack (\`hizPlane\`), so that a level-1 bound holds every plane a reader sees. */
fn hizPlaneNearest(i:u32,q:vec2i,z:f32)->f32{
 let x=vec2i(1,0);let y=vec2i(0,1);
 let slopes=vec2f(
  surfaceSlopeOf(z,hizDepthAt(q-x),hizDepthAt(q+x),hizDepthAt(q-x*2),hizDepthAt(q+x*2)),
  surfaceSlopeOf(z,hizDepthAt(q-y),hizDepthAt(q+y),hizDepthAt(q-y*2),hizDepthAt(q+y*2)));
 let word=pack2x16float(select(vec2f(0.0),slopes/z,z>0.0));
 hizPut(i,${HIZ_NEAREST}u,word);
 let s=unpack2x16float(word)*z;
 return z+0.5*(abs(s.x)+abs(s.y));
}
/** A texel of the pass's source level at \`at\`, its pair of bounds: when the source sits at offset
 *  zero, the level-0 texture — copied into the culling layer on the way, or its plane written into
 *  the nearest, beside its depth —; else the level the previous pass wrote. */
fn hizSource(at:u32,x:u32,y:u32)->vec2f{
 let i=at+y*uni.b+x;
 if(uni.a!=0u){return hizLoadBound(i);}
 let q=vec2i(i32(x),i32(y));
 let depth=textureLoad(level0,q,0).r;
 if(${HIZ_NEAREST_BUILD}){return vec2f(hizPlaneNearest(i,q,depth),depth);}
 hizPut(i,${HIZ_CULL_FARTHEST}u,bitcast<u32>(depth));
 return vec2f(depth);
}
/** The bounds of two pairs: reverse-Z, the farthest is the MINIMUM, the nearest the MAXIMUM; the
 *  second of a pair is always the farthest. */
fn hizBound(a:vec2f,b:vec2f)->vec2f{
 if(${HIZ_NEAREST_BUILD}){return vec2f(max(a.x,b.x),min(a.y,b.y));}
 return vec2f(min(a.x,b.x));
}
/** The bound of a 2 × 2 square read clamped to its level: the right column counts when \`dx\`
 *  is 1, the bottom row when \`dy\` is 1, in the order of the per-level reduction. */
fn hizBound4(v00:vec2f,v10:vec2f,v01:vec2f,v11:vec2f,dx:u32,dy:u32)->vec2f{
 var bound=v00;
 if(dx!=0u){bound=hizBound(bound,v10);}
 if(dy!=0u){
  bound=hizBound(bound,v01);
  if(dx!=0u){bound=hizBound(bound,v11);}
 }
 return bound;
}
@compute @workgroup_size(${S}, ${S})
fn buildHiz(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u){
 // uni: a the source level's index, b × c its size, d the levels this pass writes (dst), upper the
 // texels of the coarser levels of one bound (\`hizIn\`).
 let at=uni.a;
 let x=wg.x*${S}u+lid.x;let y=wg.y*${S}u+lid.y;let x0=x*2u;let y0=y*2u;
 var bound=vec2f(0.0);
 if(x0<uni.b&&y0<uni.c){
  let dx=select(0u,1u,x0+1u<uni.b);let dy=select(0u,1u,y0+1u<uni.c);
  bound=hizBound4(hizSource(at,x0,y0),hizSource(at,x0+dx,y0),hizSource(at,x0,y0+dy),hizSource(at,x0+dx,y0+dy),dx,dy);
  if(uni.d>0u){hizPutBound(uni.dst[0].x+y*uni.dst[0].y+x,bound);}
 }
 hizTile[lid.y*${S}u+lid.x]=bound;
 // Each further level halves the threads at work; the one the tile holds is read, then replaced.
 var side=${S}u;
 for(var k=1u;k<min(uni.d,${HIZ_PASS_LEVELS}u);k++){
  side=side>>1u;
  workgroupBarrier();
  let src=uni.dst[k-1u];let dst=uni.dst[k];
  let tx=wg.x*side+lid.x;let ty=wg.y*side+lid.y;
  let live=lid.x<side&&lid.y<side&&tx<dst.y&&ty<dst.z;
  if(live){
   let i=lid.y*${2 * S}u+lid.x*2u;
   let dx=select(0u,1u,tx*2u+1u<src.y);let dy=select(0u,1u,ty*2u+1u<src.z);
   bound=hizBound4(hizTile[i],hizTile[i+dx],hizTile[i+dy*${S}u],hizTile[i+dy*${S}u+dx],dx,dy);
  }
  workgroupBarrier();
  if(live){
   hizTile[lid.y*${S}u+lid.x]=bound;
   hizPutBound(dst.x+ty*dst.y+tx,bound);
  }
 }
}
// Only boxes the frame tests travel this far, each carrying the verdict row it answers for;
// every other drawable row holds the verdict the partition wrote this frame (\`classifyRows\`).
// The box count is the one the partition compacted: the CPU does not know it, \`testHizArgs\`
// sizes the dispatch by it.
// Its reject counters, on a sampled frame only (\`uni.counting\`, \`STATE_TALLY_WGSL\`).
@compute @workgroup_size(${HIZ_TEST_WORKGROUP})
fn testHiz(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(id,n,${HIZ_TEST_WORKGROUP}u);
 if(i<atomicLoad(&state[${ST_TESTED}u])){testBox(i);}
 flushTally(lane);
}
/** The test's indirect arguments: one workgroup of threads per 64 compacted boxes, in rows. */
@compute @workgroup_size(1)
fn testHizArgs(){
 let g=groupGrid(ceilDiv(atomicLoad(&state[${ST_TESTED}u]),${HIZ_TEST_WORKGROUP}u));
 testArgs[0]=g.x;testArgs[1]=g.y;testArgs[2]=1u;
}
fn testBox(i:u32){
 let b=bounds[i];
 let row=b.rowAndClip>>1u;
 // A tested row the pyramid cannot judge stays drawn: kept, never an occluder — the compute
 // raster draws occluders in its other mode. A row with no verdict slot (never culled) is not
 // judged either: no reject is counted for a row that draws.
 if(pages[row].hizSlot==0xffffffffu||(b.rowAndClip&1u)!=0u||b.maxX<b.minX||b.maxY<b.minY){flags[row]=${VERDICT_KEPT}u;return;}
 // Reverse-Z: a box is rejected when its NEAREST point stays behind the pyramid's farthest,
 // hence when it is SMALLER. The coarse mip the partition packed is read first (\`pyramidHides\`).
 let reject=select(0u,1u,pyramidHides(b.minX,b.minY,b.maxX,b.maxY,b.fineOffset,b.fineWidth,b.nearest,b.coarseOffset,b.coarseWidth,b.coarseShift));
 flags[row]=select(${VERDICT_KEPT}u,${VERDICT_REJECTED}u,reject!=0u);
 if(reject!=0u){
  tallyAdd(${ST_REJECTED}u,1u);
  tallyAdd(${ST_REJECTED_TRIANGLES}u,b.triangles);
 }
}
`,
  [
    PAGE_INFO_STRUCT_WGSL,
    FLAT_INDEX_WGSL,
    GROUP_GRID_WGSL,
    ceilDiv,
    STATE_TALLY_WGSL,
    HIZ_HIDES_WGSL,
    HIZ_TEXEL_WGSL,
    SURFACE_SLOPE_WGSL,
  ],
)
