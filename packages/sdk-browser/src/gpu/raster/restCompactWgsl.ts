import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts';
import { BASE_SLOTS } from '../draw/contract.ts';
import { HIZ_REJECTED_WGSL } from '../partition/contract.ts';
import { LANE_SCAN_WGSL } from '../core/laneScanWgsl.ts';

/** Instances of one tile: the threads of a count or scatter workgroup. */
export const REST_COMPACT_WORKGROUP = 64;

/**
 * Stable compaction of the tested half, between the occlusion test and the second geometry pass.
 *
 * A row whose cluster the pyramid rejected would still be drawn: its indirect command counted its
 * instances before the verdict existed, and the vertex stage would then discard each of its
 * vertices one by one — the vertex count of the model's largest page per rejected instance. Here
 * each tested slot keeps its surviving instances only — the negation of the same `hizRejected` as
 * the vertex stage — in the order the draw compaction gave them, and its command counts them. A
 * rejected instance drew nothing: the frame is identical by construction, and no vertex is
 * launched for it any more.
 *
 * Three dispatches, all in one pass:
 *  - `restCount`, a workgroup per tile of 64 instances of a slot: each lane copies its instance
 *    into `work` at its own place and the workgroup counts the survivors of its tile;
 *  - `restScan`, one workgroup: slot by slot, the tile counts become tile offsets through a scan
 *    over the 64 lanes, and the survivor total becomes the command's instance count;
 *  - `restScatter`: each survivor is written back from the copy at its tile's offset plus its rank
 *    among the earlier survivors of its tile. Reading the copy, not the list being rewritten, is
 *    what lets a tile move its survivors over the places of tiles still to be read.
 *
 * `work` holds the copy over the instance list's own range (`uni.copyWords`), then each slot's
 * instance count as it was, then `uni.tiles` tile words per slot. Only `uni.tiles` tiles of a slot
 * are read: the instances past them are dropped, as the truncation before this compaction did.
 */
export const REST_COMPACT_SHADER = `${PAGE_INFO_STRUCT_WGSL}
struct Uniforms{restSlots:u32,tiles:u32,copyWords:u32,pad0:u32,}
@group(0) @binding(0) var<storage, read_write> instances:array<u32>;
@group(0) @binding(1) var<storage, read_write> indirect:array<u32>;
@group(0) @binding(2) var<storage, read> slotOffsets:array<u32>;
@group(0) @binding(3) var<storage, read> pages:array<PageInfo>;
@group(0) @binding(4) var<storage, read> hizFlags:array<u32>;
@group(0) @binding(5) var<storage, read_write> work:array<u32>;
@group(0) @binding(6) var<uniform> uni:Uniforms;
${HIZ_REJECTED_WGSL}
/** Rank of tested slot number \`n\`: three face modes per layer, after the three occluders. */
fn restSlotAt(n:u32)->u32{return (n/${BASE_SLOTS / 2}u)*${BASE_SLOTS}u+${BASE_SLOTS / 2}u+n%${BASE_SLOTS / 2}u;}
fn survives(row:u32)->bool{return !hizRejected(pages[row].hizSlot);}
/** Word of \`work\` holding tested slot \`n\`'s instance count before the compaction. */
fn countWord(n:u32)->u32{return uni.copyWords+n;}
/** Word of \`work\` holding tile \`t\` of tested slot \`n\`: its survivors, then its offset. */
fn tileWord(n:u32,t:u32)->u32{return uni.copyWords+uni.restSlots+n*uni.tiles+t;}
var<workgroup> tileKept:atomic<u32>;
@compute @workgroup_size(${REST_COMPACT_WORKGROUP})
fn restCount(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){
 let n=wg.y;let t=wg.x;
 if(n>=uni.restSlots){return;}
 let slot=restSlotAt(n);
 let count=min(indirect[slot*4u+1u],uni.tiles*${REST_COMPACT_WORKGROUP}u);
 let x=t*${REST_COMPACT_WORKGROUP}u+lane;
 if(x<count){
  let at=slotOffsets[slot]+x;
  let row=instances[at];
  work[at]=row;
  if(survives(row)){atomicAdd(&tileKept,1u);}
 }
 workgroupBarrier();
 if(lane==0u){
  work[tileWord(n,t)]=atomicLoad(&tileKept);
  if(t==0u){work[countWord(n)]=count;}
 }
}
${LANE_SCAN_WGSL}var<workgroup> slotCount:u32;
@compute @workgroup_size(64)
fn restScan(@builtin(local_invocation_index) lane:u32){
 for(var n=0u;n<uni.restSlots;n++){
  if(lane==0u){slotCount=work[countWord(n)];}
  let tiles=(workgroupUniformLoad(&slotCount)+${REST_COMPACT_WORKGROUP - 1}u)/${REST_COMPACT_WORKGROUP}u;
  let run=(tiles+63u)/64u;
  let first=min(lane*run,tiles);let last=min(first+run,tiles);
  var sum=0u;
  for(var t=first;t<last;t++){sum=sum+work[tileWord(n,t)];}
  // Inclusive scan of the run totals over the lanes.
  let inclusive=laneScan(lane,sum);
  var cursor=inclusive-sum;
  for(var t=first;t<last;t++){
   let kept=work[tileWord(n,t)];
   work[tileWord(n,t)]=cursor;
   cursor=cursor+kept;
  }
  if(lane==0u){indirect[restSlotAt(n)*4u+1u]=laneSums[63u];}
  workgroupBarrier();
 }
}
@compute @workgroup_size(${REST_COMPACT_WORKGROUP})
fn restScatter(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){
 let n=wg.y;let t=wg.x;
 if(n>=uni.restSlots){return;}
 let slot=restSlotAt(n);
 let start=slotOffsets[slot];
 let x=t*${REST_COMPACT_WORKGROUP}u+lane;
 var row=0u;var kept=0u;
 if(x<work[countWord(n)]){row=work[start+x];kept=select(0u,1u,survives(row));}
 // Its rank among the earlier survivors of its tile: the exclusive scan of the kept flags.
 let rank=laneScan(lane,kept)-kept;
 if(kept!=0u){instances[start+work[tileWord(n,t)]+rank]=row;}
}
`;
