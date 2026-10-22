import { computeBufferEntries } from '../../gpu/core/computeBindings.ts'
import { LANE_SCAN_WGSL, laneRunOffsets } from '../../gpu/core/laneScanWgsl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import {
  BASE_SLOTS,
  BATCH_SHIFT,
  BIN_KIND,
  CULL_BINS,
  DRAW_ITEM_WGSL,
  HALF_SLOTS,
  RASTER_SOFTWARE,
  slotCount,
} from './contract.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { ceilDivWgsl } from '../../../../math/src/wgsl/integer.ts'
import { NO_INDEX } from '../../../../math/src/wgsl/constants.ts'
import { DRAW_MASK_WGSL } from '../../geometry/dag/shader/drawMaskWgsl.ts'

/**
 * THE stable compaction of the frame's draw items into one indirect command per slot, run once per
 * pass of the cut: the main half before the main pass's raster, its rows those the frame mask holds
 * then, and the post half after the post pass, its rows those the post mask holds. Each half reads
 * its mask through its own uniform (`uni.selectionOffset`): a row the cut left out launches no
 * vertex, and no second pass rescans the instances already listed.
 *
 * An item takes one instance per batch of its triangles (`batchesOf`, `drawBatches`), consecutive
 * and in triangle order, so its row's triangles reach the raster as one instance per row drew them.
 *
 * A slot is a bin — a cull mode, its cutout bin, its voxel bin or, for a row the software raster
 * draws this image, its software bin (`binOf`) —, a main or post half and a coplanar depth
 * layer (`contract.ts`). The layer is a property of the page-table row, not of the
 * frame, so it travels with the item and never costs a branch per pixel.
 *
 * Counting and scattering run one workgroup per group of 64 items: each lane reads its own item
 * once, tallies its slot in workgroup memory, and ranks itself among the earlier lanes of the same
 * slot. Each group adds its non-zero tallies to its slot's total: one atomic per group and slot it
 * fills, and a slot that no item of the half reaches costs the prefix nothing. The prefix, one
 * workgroup, takes each slot's total (and leaves zero for the next run), skips an empty slot, and
 * spreads the groups of a filled one over its lanes, a scan of their run totals giving each group
 * its offset — the serial walk's result term for term. The main run leaves where its
 * instances end in total `slots`, where the post run starts, and writes the post slots
 * empty: an image whose cut ran in one pass draws no post instance. The groups' offsets and their
 * counts are the two regions of one storage buffer, `groups` (`drawGroupWords`), read and written
 * plainly; the slots' totals, the one word the groups sum at once, follow the commands in
 * `indirect` (`drawIndirectBytes`), its one atomic binding. Each half binds 5 storage buffers.
 * `../../../../../bench/oracles/browser/gpuDrawPrefixOracle.ts` carries the kernels and
 * `prefixEquivalence.test.ts` the proof.
 */
/** Group-0 bindings of a half's compaction, published under the WGSL that declares them, the same
 *  for both halves. */
export function drawBindEntries(): GPUBindGroupLayoutEntry[] {
  return computeBufferEntries([
    'read-only-storage',
    'uniform',
    'storage',
    'storage',
    'storage',
    'read-only-storage',
  ])
}

/** The label of a half's compaction module — the main pass's, or the post pass's (`drawShader`) —:
 *  what tells the two apart on a device that runs them. */
export const drawModuleLabel = (post: boolean) =>
  post ? 'draw compaction post' : 'draw compaction'

export const drawShader = (layerSlots: number, post = false) => {
  const slots = slotCount(layerSlots)
  const top = Math.max(0, Math.max(1, layerSlots) - 1)
  const half = post ? 1 : 0
  return wgslProgram(
    `struct Uniforms{count:u32,corners:u32,slotCap:u32,groupCount:u32,selectionEnabled:u32,selectionOffset:u32,perRow:u32,groupEntries:u32,}
@group(0) @binding(0) var<storage, read> items:array<DrawItem>;
@group(0) @binding(1) var<uniform> uni:Uniforms;
@group(0) @binding(2) var<storage, read_write> instances:array<u32>;
@group(0) @binding(3) var<storage, read_write> indirect:array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> groups:array<u32>;
@group(0) @binding(5) var<storage, read> selectionMask:array<u32>;
/** The \`groups\` regions (\`drawGroupWords\`), \`uni.groupEntries\` words each: group \`group\`'s
 *  offset in \`slot\`, then its count. */
fn groupOffsetAt(group:u32,slot:u32)->u32{return group*${slots}u+slot;}
fn groupCountAt(group:u32,slot:u32)->u32{return uni.groupEntries+groupOffsetAt(group,slot);}
/** \`slot\`'s total behind the commands of \`indirect\` (\`drawIndirectBytes\`), total \`${slots}\`
 *  where the main half's instances end: atomic, the groups sum them at once. */
fn slotTotalAt(slot:u32)->u32{return ${4 * slots}u+slot;}
/** Whether the half's mask holds \`item\`: the frame mask before the post pass for the main half,
 *  the post mask for the post half; without a cut, every item is the main half's. */
fn selected(item:DrawItem)->bool{return uni.selectionEnabled==0u||maskSelects(item.selectionIndex);}
/** The bin of \`item\` this image: its own, or its face mode's software bin when the software
 *  raster draws it (\`raster\`, written by the cluster split before this pass). */
fn binOf(item:DrawItem)->u32{
 return select(item.bin,${BIN_KIND.SOFTWARE * CULL_BINS}u+item.bin%${CULL_BINS}u,item.raster==${RASTER_SOFTWARE}u);
}
/** The slot of \`item\` in half \`post\`: the one formula of a slot, the layer capped at the last. */
fn slotOf(post:u32,item:DrawItem)->u32{return post*${HALF_SLOTS}u+binOf(item)+${BASE_SLOTS}u*min(item.layer,${top}u);}
/** The half slot \`slot\` belongs to: a layer's main bins, then its post ones. */
fn halfOf(slot:u32)->u32{return (slot%${BASE_SLOTS}u)/${HALF_SLOTS}u;}
fn writeCmd(slot:u32,count:u32){
 let o=slot*4u;
 atomicStore(&indirect[o],uni.corners);atomicStore(&indirect[o+1u],count);
 atomicStore(&indirect[o+2u],0u);atomicStore(&indirect[o+3u],0u);
}
/** Instances \`item\` draws as: its corners by batches of \`corners\`, at least one, at most the
 *  \`perRow\` the instance list holds a row. */
fn batchesOf(item:DrawItem)->u32{return clamp(ceilDiv(item.triangles*3u,uni.corners),1u,uni.perRow);}
var<workgroup> laneSlots:array<u32,WORKGROUP_THREADS>;
var<workgroup> laneBatches:array<u32,WORKGROUP_THREADS>;
var<workgroup> slotTally:array<atomic<u32>,${slots}>;
var<workgroup> laneWord:u32;
/** The slot item \`i\` draws in, or \`NO_INDEX\` when it lies at or past \`end\` or the half's mask
 *  does not hold it. */
fn slotAt(i:u32,end:u32)->u32{
 if(i>=end){return NO_INDEX;}
 let item=items[i];
 if(!selected(item)){return NO_INDEX;}
 return slotOf(${half}u,item);
}
/** \`value\`, lane 0's, the same in every lane. */
fn broadcast(lane:u32,value:u32)->u32{
 if(lane==0u){laneWord=value;}
 let word=workgroupUniformLoad(&laneWord);
 // Every lane holds it before lane 0 may write the next.
 workgroupBarrier();
 return word;
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn countGroups(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){
 // A group of the last row past the count has no count to write.
 let group=flatIndex(wg,n,1u);
 if(group>=uni.groupCount){return;}
 // \`slotTally\` starts at zero: WGSL zero-initializes workgroup memory for each workgroup.
 let i=group*WORKGROUP_THREADS+lane;
 let s=slotAt(i,min(uni.count,uni.slotCap));
 if(s!=NO_INDEX){atomicAdd(&slotTally[s],batchesOf(items[i]));}
 workgroupBarrier();
 for(var slot=lane;slot<${slots}u;slot+=WORKGROUP_THREADS){
  if(halfOf(slot)!=${half}u){continue;}
  let tally=atomicLoad(&slotTally[slot]);
  groups[groupCountAt(group,slot)]=tally;
  if(tally!=0u){atomicAdd(&indirect[slotTotalAt(slot)],tally);}
 }
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn prefixGroups(@builtin(local_invocation_index) lane:u32){
 let overflow=uni.count>uni.slotCap;
 let span=laneRun(lane,uni.groupCount);
 var start=${post ? `broadcast(lane,atomicLoad(&indirect[slotTotalAt(${slots}u)]))` : '0u'};
 for(var slot=0u;slot<${slots}u;slot++){
  if(halfOf(slot)!=${half}u){
   ${post ? '' : 'if(lane==0u){writeCmd(slot,0u);}'}
   continue;
  }
  // The slot's total, left at zero for the next run; an empty slot skips the scan.
  var held=0u;
  if(lane==0u){held=atomicExchange(&indirect[slotTotalAt(slot)],0u);}
  let total=broadcast(lane,held);
  if(total==0u||overflow){
   if(lane==0u){writeCmd(slot,0u);}
   continue;
  }
  ${laneRunOffsets('group', 'span', 'lane', 'start+', 'groups[groupCountAt(group,slot)]', 'groups[groupOffsetAt(group,slot)]=cursor')}
  if(lane==0u){writeCmd(slot,total);}
  start=start+total;
  workgroupBarrier();
 }
 ${post ? '' : `if(lane==0u){atomicStore(&indirect[slotTotalAt(${slots}u)],start);}`}
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn scatterGroups(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){
 if(uni.count>uni.slotCap){return;}
 let group=flatIndex(wg,n,1u);let i=group*WORKGROUP_THREADS+lane;
 // The rank is the count of EARLIER lanes of the group in the same slot: the item's place in
 // the group's stable order.
 let s=slotAt(i,uni.count);
 var batches=0u;
 if(s!=NO_INDEX){batches=batchesOf(items[i]);}
 laneSlots[lane]=s;
 laneBatches[lane]=batches;
 workgroupBarrier();
 if(s==NO_INDEX){return;}
 var rank=0u;
 for(var j=0u;j<lane;j++){if(laneSlots[j]==s){rank=rank+laneBatches[j];}}
 // A row's batches follow one another, so its triangles reach the raster in their page order.
 let at=groups[groupOffsetAt(group,s)]+rank;let page=items[i].pageIndex;
 let stride=uni.corners/3u;
 for(var b=0u;b<batches;b++){instances[at+b]=page|((b*stride)<<${BATCH_SHIFT}u);}
}
`,
    [
      DRAW_ITEM_WGSL,
      LANE_SCAN_WGSL,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
      ceilDivWgsl,
      DRAW_MASK_WGSL,
      NO_INDEX,
    ],
  )
}
