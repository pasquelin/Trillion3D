import { COMPUTE } from '../core/computeBindings.ts';
import {
  STATE_TALLY_WGSL,
  ST_REJECTED,
  ST_REJECTED_TRIANGLES,
  ST_TESTED,
  VERDICT_KEPT,
  VERDICT_REJECTED,
} from '../partition/contract.ts';
import { HIZ_HIDES_WGSL } from './rectWgsl.ts';
import { HIZ_BUILD_SIDE as S, HIZ_PASS_LEVELS } from './uniforms.ts';
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts';

/**
 * Group-0 bindings, published under the WGSL that declares them. The production layout and the
 * GPU proofs READ them here — none copies them, so none can lag behind the shader. That lag is
 * what turned the Hi-Z occlusion proof (`tests/gpu/hiz/occlusion-test.gpu.ts`) red: its copy had
 * stopped at `@binding(4)` while `state` entered at 5.
 */
export function hizBindEntries(uniformBytes: number): GPUBindGroupLayoutEntry[] {
  return [
    { binding: 0, visibility: COMPUTE, buffer: { type: 'storage' } },
    { binding: 1, visibility: COMPUTE, texture: { sampleType: 'unfilterable-float' } },
    {
      binding: 2,
      visibility: COMPUTE,
      buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: uniformBytes },
    },
    { binding: 3, visibility: COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 4, visibility: COMPUTE, buffer: { type: 'storage' } },
    { binding: 5, visibility: COMPUTE, buffer: { type: 'storage' } },
  ];
}

/** Group 1, the test's alone: the page table, whose Hi-Z slot word tells a row that has no
 *  verdict (never culled). The pyramid kernels bind group 0 only, the page pyramids included. */
export const HIZ_TEST_PAGES_ENTRIES: GPUBindGroupLayoutEntry[] = [
  { binding: 0, visibility: COMPUTE, buffer: { type: 'read-only-storage' } },
];

/**
 * The Hi-Z kernels: the pyramid build and the test. The test no longer receives a count or bytes
 * from the CPU: it reads the box count and writes its own reject counters into the state the GPU
 * partition holds, and the boxes are those the partition packed in the same submission. No value
 * is inferred there: a verdict is written, or the row stays at zero.
 *
 * The build reduces `HIZ_PASS_LEVELS` mips per dispatch through workgroup memory (`buildHiz`):
 * each thread reads one 2 × 2 square of the source level and the workgroup reduces its 8 × 8
 * results down to one texel, each level the farthest of four taken in the same order as a
 * per-level reduction, so every mip holds the same value. The first pass reads the level-0
 * texture itself: it copies each texel into the pyramid — the tests and the next image's cull
 * read level 0 there — and reduces level 1 from the texels it just read, never rereading the
 * copy. It also builds several pyramids in one dispatch, one per `z`: `uni.g` is then the stride
 * between two pyramids and each one's level 0 starts at the texel its `bounds` entry names — the
 * several pyramids at once. The camera's `g` is zero: one pyramid, from
 * texel zero.
 */
export const HIZ_SHADER = `${PAGE_INFO_STRUCT_WGSL}
struct Uni{a:u32,b:u32,c:u32,d:u32,g:u32,counting:u32,pad1:u32,pad2:u32,dst:array<vec4u,${HIZ_PASS_LEVELS}>,}
struct Bounds{minX:i32,minY:i32,maxX:i32,maxY:i32,nearest:f32,rowAndClip:u32,fineOffset:u32,fineWidth:u32,triangles:u32,coarseOffset:u32,coarseWidth:u32,coarseShift:u32,}
@group(0) @binding(0) var<storage, read_write> pyramid:array<f32>;
@group(0) @binding(1) var level0:texture_2d<f32>;
@group(0) @binding(2) var<uniform> uni:Uni;
@group(0) @binding(3) var<storage, read> bounds:array<Bounds>;
@group(0) @binding(4) var<storage, read_write> flags:array<u32>;
@group(0) @binding(5) var<storage, read_write> state:array<atomic<u32>>;
@group(1) @binding(0) var<storage, read> pages:array<PageInfo>;
var<workgroup> hizTile:array<f32,${S ** 2}>;
${STATE_TALLY_WGSL}
/** A texel of the pass's source level at \`at\`: the level-0 texture, copied into the pyramid on
 *  the way, when the source sits at offset zero; else the level the previous pass wrote. */
fn hizSource(at:u32,origin:vec2i,x:u32,y:u32)->f32{
 let i=at+y*uni.b+x;
 if(uni.a!=0u){return pyramid[i];}
 let depth=textureLoad(level0,origin+vec2i(i32(x),i32(y)),0).r;
 pyramid[i]=depth;
 return depth;
}
/** The farthest of a 2 × 2 square read clamped to its level: the right column counts when \`dx\`
 *  is 1, the bottom row when \`dy\` is 1, in the order of the per-level reduction.
 *  Reverse-Z: the FARTHEST is the MINIMUM. */
fn hizFar4(v00:f32,v10:f32,v01:f32,v11:f32,dx:u32,dy:u32)->f32{
 var far=v00;
 if(dx!=0u){far=min(far,v10);}
 if(dy!=0u){
  far=min(far,v01);
  if(dx!=0u){far=min(far,v11);}
 }
 return far;
}
@compute @workgroup_size(${S}, ${S})
fn buildHiz(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u){
 // uni: a the source level's offset, b × c its size, d the levels this pass writes (dst), g the
 // stride between two pyramids.
 let z=wg.z;let at=uni.a+z*uni.g;
 var origin=vec2i(0);
 if(uni.a==0u&&uni.g!=0u){origin=vec2i(bounds[z].minX,bounds[z].minY);}
 let x=wg.x*${S}u+lid.x;let y=wg.y*${S}u+lid.y;let x0=x*2u;let y0=y*2u;
 var far=0.0;
 if(x0<uni.b&&y0<uni.c){
  let dx=select(0u,1u,x0+1u<uni.b);let dy=select(0u,1u,y0+1u<uni.c);
  far=hizFar4(hizSource(at,origin,x0,y0),hizSource(at,origin,x0+dx,y0),hizSource(at,origin,x0,y0+dy),hizSource(at,origin,x0+dx,y0+dy),dx,dy);
  if(uni.d>0u){pyramid[uni.dst[0].x+z*uni.g+y*uni.dst[0].y+x]=far;}
 }
 hizTile[lid.y*${S}u+lid.x]=far;
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
   far=hizFar4(hizTile[i],hizTile[i+dx],hizTile[i+dy*${S}u],hizTile[i+dy*${S}u+dx],dx,dy);
  }
  workgroupBarrier();
  if(live){
   hizTile[lid.y*${S}u+lid.x]=far;
   pyramid[dst.x+z*uni.g+ty*dst.y+tx]=far;
  }
 }
}
${HIZ_HIDES_WGSL}
// Only boxes the frame tests travel this far, each carrying the verdict row it answers for;
// every other drawable row holds the verdict the partition wrote this frame (\`classifyRows\`).
// The box count is the one the partition compacted: the CPU does not know it.
// Its reject counters, on a sampled frame only (\`uni.counting\`, \`STATE_TALLY_WGSL\`).
@compute @workgroup_size(64)
fn testHiz(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 if(id.x<atomicLoad(&state[${ST_TESTED}u])){testBox(id.x);}
 flushTally(lane);
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
`;
