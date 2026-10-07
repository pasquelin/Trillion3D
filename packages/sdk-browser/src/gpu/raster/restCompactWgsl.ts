import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { BASE_SLOTS, HALF_SLOTS, INSTANCE_WORD_WGSL } from '../draw/contract.ts'
import { HIZ_REJECTED_WGSL } from '../partition/contract.ts'
import { LANE_SCAN_WGSL } from '../core/laneScanWgsl.ts'
import { FLAT_GROUP_WGSL } from '../dag/shader/gridWgsl.ts'

/** Instances of one tile: the threads of a count or scatter workgroup. */
export const REST_COMPACT_WORKGROUP = 64

/**
 * Stable compaction of the tested half, between the occlusion test and the second geometry pass.
 *
 * A row whose cluster the pyramid rejected would still be drawn: its indirect command counted its
 * instances before the verdict existed, and the vertex stage would then discard each of its
 * vertices one by one — the vertex count of the model's largest page per rejected instance. Here
 * each tested slot keeps its surviving instances only — the negation of the same `hizRejected` as
 * the vertex stage — in the order the draw compaction gave them, and its command counts them. A
 * rejected instance draws nothing: the frame is identical by construction, and no vertex is
 * launched for it.
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
 * are read: the instances past them are dropped, as a truncation does.
 *
 * A count or scatter dispatch runs a slot up y and its tiles along x, in rows up z past one
 * dimension's groups (`dispatchGrid`): a tile is ranked off x and z (`tileOf`), and a group past
 * the tiles leaves.
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
${INSTANCE_WORD_WGSL}
/** Rank of tested slot number \`n\`: a layer's tested bins, after its occluder ones. */
fn restSlotAt(n:u32)->u32{return (n/${HALF_SLOTS}u)*${BASE_SLOTS}u+${HALF_SLOTS}u+n%${HALF_SLOTS}u;}
/** An instance word's verdict: its row's. */
fn survives(word:u32)->bool{return !hizRejected(pages[instanceRow(word)].hizSlot);}
/** Word of \`work\` holding tested slot \`n\`'s instance count before the compaction. */
fn countWord(n:u32)->u32{return uni.copyWords+n;}
/** Word of \`work\` holding tile \`t\` of tested slot \`n\`: its survivors, then its offset. */
fn tileWord(n:u32,t:u32)->u32{return uni.copyWords+uni.restSlots+n*uni.tiles+t;}
${FLAT_GROUP_WGSL}/** Tile of workgroup \`wg\` of a dispatch of \`n\` groups: x, then rows of them up z. */
fn tileOf(wg:vec3u,n:vec3u)->u32{return flatGroup(wg.x,wg.z,n.x);}
var<workgroup> tileKept:atomic<u32>;
var<workgroup> slotCount:u32;
/** Tested slot \`n\`'s count, broadcast so an empty tile can leave from uniform control flow. */
fn sharedCount(lane:u32,count:u32)->u32{
 if(lane==0u){slotCount=count;}
 return workgroupUniformLoad(&slotCount);
}
@compute @workgroup_size(${REST_COMPACT_WORKGROUP})
fn restCount(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) groups:vec3u){
 let n=wg.y;let t=tileOf(wg,groups);
 if(n>=uni.restSlots||t>=uni.tiles){return;}
 let slot=restSlotAt(n);
 let count=sharedCount(lane,min(indirect[slot*4u+1u],uni.tiles*${REST_COMPACT_WORKGROUP}u));
 // Tiles past the count are never scanned; tile 0 still records the count.
 if(t>0u&&t*${REST_COMPACT_WORKGROUP}u>=count){return;}
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
${LANE_SCAN_WGSL}@compute @workgroup_size(64)
fn restScan(@builtin(local_invocation_index) lane:u32){
 for(var n=0u;n<uni.restSlots;n++){
  let tiles=(sharedCount(lane,work[countWord(n)])+${REST_COMPACT_WORKGROUP - 1}u)/${REST_COMPACT_WORKGROUP}u;
  let span=laneRun(lane,tiles);
  var sum=0u;
  for(var t=span.x;t<span.y;t++){sum=sum+work[tileWord(n,t)];}
  // Inclusive scan of the run totals over the lanes.
  var cursor=laneScan(lane,sum)-sum;
  for(var t=span.x;t<span.y;t++){
   let kept=work[tileWord(n,t)];
   work[tileWord(n,t)]=cursor;
   cursor=cursor+kept;
  }
  if(lane==0u){indirect[restSlotAt(n)*4u+1u]=laneSums[63u];}
  workgroupBarrier();
 }
}
@compute @workgroup_size(${REST_COMPACT_WORKGROUP})
fn restScatter(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) groups:vec3u){
 let n=wg.y;let t=tileOf(wg,groups);
 if(n>=uni.restSlots||t>=uni.tiles){return;}
 let count=sharedCount(lane,work[countWord(n)]);
 let x=t*${REST_COMPACT_WORKGROUP}u+lane;
 // A tile past the count moves nothing: it leaves before the scan.
 if(t*${REST_COMPACT_WORKGROUP}u>=count){return;}
 let start=slotOffsets[restSlotAt(n)];
 var row=0u;var kept=0u;
 if(x<count){row=work[start+x];kept=select(0u,1u,survives(row));}
 // Its rank among the earlier survivors of its tile: the exclusive scan of the kept flags.
 let rank=laneScan(lane,kept)-kept;
 if(kept!=0u){instances[start+work[tileWord(n,t)]+rank]=row;}
}
`
