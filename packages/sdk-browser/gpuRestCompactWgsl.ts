import { PAGE_INFO_STRUCT_WGSL } from './visibilityPageWgsl.ts';
import { BASE_SLOTS } from './gpuDrawContract.ts';
import { HIZ_REJECTED_WGSL } from './gpuPartitionContract.ts';

/** Threads of a mark workgroup: one tile of tested-half instances. */
export const REST_COMPACT_WORKGROUP = 64;

/**
 * Truncation of the tested half, between the occlusion test and the second geometry pass.
 *
 * A row whose cluster the pyramid rejected was still drawn: its indirect command counted its
 * instances before the verdict existed, and the vertex stage then discarded each of its vertices
 * one by one. The draw wrote no pixel, but the device still launched, for each of those
 * instances, the vertex count of the model's largest page.
 *
 * This kernel looks up the RANK OF THE LAST SURVIVOR of each tested slot — the negation of the
 * same `hizRejected` as the vertex stage — and brings the command's instance count back to that
 * rank. What falls out of the count is a suffix of all-rejected instances that drew nothing: the
 * frame is identical by construction, and the ORDER of the kept instances does not move by one
 * rank, since nothing is moved.
 *
 * There is no compact of holes in the middle: a stable compact needs a prefix, hence a workgroup
 * barrier under a loop bounded by the instance count — which WGSL refuses, that count being
 * read from a storage buffer ("must only be called from uniform control flow"). The atomic
 * maximum, for its part, needs no barrier.
 */
export const REST_COMPACT_SHADER = `${PAGE_INFO_STRUCT_WGSL}
struct Uniforms{restSlots:u32,pad0:u32,pad1:u32,pad2:u32,}
@group(0) @binding(0) var<storage, read> instances:array<u32>;
@group(0) @binding(1) var<storage, read_write> indirect:array<u32>;
@group(0) @binding(2) var<storage, read> slotOffsets:array<u32>;
@group(0) @binding(3) var<storage, read> pages:array<PageInfo>;
@group(0) @binding(4) var<storage, read> hizFlags:array<u32>;
@group(0) @binding(5) var<storage, read_write> dernieres:array<atomic<u32>>;
@group(0) @binding(6) var<uniform> uni:Uniforms;
${HIZ_REJECTED_WGSL}
/** Rank of tested slot number \`n\`: three face modes per layer, after the three occluders. */
fn restSlotAt(n:u32)->u32{return (n/${BASE_SLOTS / 2}u)*${BASE_SLOTS}u+${BASE_SLOTS / 2}u+n%${BASE_SLOTS / 2}u;}
fn vivante(ligne:u32)->bool{return !hizRejected(pages[ligne].hizSlot);}
@compute @workgroup_size(${REST_COMPACT_WORKGROUP})
fn restMark(@builtin(global_invocation_id) id:vec3u){
 if(id.y>=uni.restSlots){return;}
 let slot=restSlotAt(id.y);
 let count=indirect[slot*4u+1u];
 if(id.x>=count){return;}
 if(vivante(instances[slotOffsets[slot]+id.x])){atomicMax(&dernieres[id.y],id.x+1u);}
}
@compute @workgroup_size(${REST_COMPACT_WORKGROUP})
fn restApply(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=uni.restSlots){return;}
 indirect[restSlotAt(id.x)*4u+1u]=atomicLoad(&dernieres[id.x]);
}
`;
