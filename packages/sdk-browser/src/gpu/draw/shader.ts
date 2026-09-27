import { COMPUTE } from '../core/computeBindings.ts';
import { LANE_SCAN_WGSL } from '../core/laneScanWgsl.ts';
import { BASE_SLOTS, DRAW_ITEM_WGSL, slotCount } from './contract.ts';

/**
 * Stable compaction of the frame's draw items into one indirect command per slot.
 *
 * A slot is a cull mode, an occluder/tested half and a coplanar depth layer. The layer is a property
 * of the page-table row, not of the frame, so it travels with the item and never costs a branch per
 * pixel: the clusters of a layer are simply drawn by their own command, with the pipeline that
 * carries that layer's depth bias.
 *
 * `slotUsed` is what the CPU counted for each slot before this pass: a slot it counted at zero holds
 * nothing here either, because the only thing this shader adds is the selection mask, which can just
 * remove items. Such a slot is written a zero count and skipped by the prefix, so a coplanar layer
 * that no cluster of the batch — or of this half of the image — reaches costs the prefix nothing.
 *
 * Counting and scattering run one workgroup per group of 64 items: each lane reads its own item
 * once, tallies its slot in workgroup memory, and ranks itself among the earlier lanes of the same
 * slot from workgroup memory too — the counts and the order of the per-(group, slot) walk, without
 * rereading the group's items from the storage buffer once per slot and per lane.
 *
 * The prefix walks the slots in order with all sixty-four threads of a single workgroup: each
 * thread totals a contiguous run of groups, the sixty-four run totals are scanned in workgroup
 * memory, and each thread writes the offsets of its run from its exclusive prefix. The result is
 * that of the serial walk term for term — u32 addition is associative, and a slot starts where
 * the totals of the slots before it end, an unused slot adding nothing. Where the slots used to
 * fall one per thread, each walking every group alone, the groups are now spread over the lanes.
 * `../../../../../bench/oracles/browser/gpuDrawPrefixOracle.ts` carries the kernels and
 * `prefixEquivalence.test.ts` the proof.
 */
/**
 * Group-0 bindings, published under the WGSL that declares them. The production layout and the
 * browser proof READ them here — none copies them, so none can lag behind the shader. That lag
 * is what turned `webgpu-draw.browser.ts` red: its copy stopped at `@binding(6)` while
 * `restBits` and `slotUsed` entered at 7 and 8.
 */
export function drawBindEntries(): GPUBindGroupLayoutEntry[] {
  const lecture = { type: 'read-only-storage' } as const;
  const ecriture = { type: 'storage' } as const;
  return [
    { binding: 0, visibility: COMPUTE, buffer: lecture },
    { binding: 1, visibility: COMPUTE, buffer: { type: 'uniform' } },
    { binding: 2, visibility: COMPUTE, buffer: ecriture },
    { binding: 3, visibility: COMPUTE, buffer: ecriture },
    { binding: 4, visibility: COMPUTE, buffer: ecriture },
    { binding: 5, visibility: COMPUTE, buffer: ecriture },
    { binding: 6, visibility: COMPUTE, buffer: lecture },
    { binding: 7, visibility: COMPUTE, buffer: lecture },
    { binding: 8, visibility: COMPUTE, buffer: lecture },
  ];
}

export const drawShader = (layerSlots: number) => {
  const slots = slotCount(layerSlots);
  const top = Math.max(0, Math.max(1, layerSlots) - 1);
  return `${DRAW_ITEM_WGSL}
struct Uniforms{count:u32,maxVertexCount:u32,slotCap:u32,groupCount:u32,selectionEnabled:u32,selectionOffset:u32,pad0:u32,pad1:u32,}
@group(0) @binding(0) var<storage, read> items:array<DrawItem>;
@group(0) @binding(1) var<uniform> uni:Uniforms;
@group(0) @binding(2) var<storage, read_write> instances:array<u32>;
@group(0) @binding(3) var<storage, read_write> indirect:array<u32>;
@group(0) @binding(4) var<storage, read_write> groupCounts:array<u32>;
@group(0) @binding(5) var<storage, read_write> groupOffsets:array<u32>;
@group(0) @binding(6) var<storage, read> selectionMask:array<u32>;
@group(0) @binding(7) var<storage, read> restBits:array<u32>;
@group(0) @binding(8) var<storage, read> slotUsed:array<u32>;
// The occluder/rest partition is the only per-frame word of an item, so it travels as one bit each.
fn restAt(i:u32)->u32{return (restBits[i>>5u]>>(i&31u))&1u;}
fn selected(item:DrawItem)->bool{
 if(uni.selectionEnabled==0u){return true;}
 return selectionMask[uni.selectionOffset+item.selectionIndex]!=0u;
}
/** GPU mirror of \`slotOf\` (cpu.ts): same product, same sum, same layer ceiling. */
fn slotOf(i:u32,item:DrawItem)->u32{return restAt(i)*3u+item.bin+${BASE_SLOTS}u*min(item.layer,${top}u);}
fn writeCmd(slot:u32,count:u32){
 let o=slot*4u;
 indirect[o]=uni.maxVertexCount;
 indirect[o+1u]=count;
 indirect[o+2u]=0u;
 indirect[o+3u]=0u;
}
/** No slot: the lane is past the frame's items, or its item is not selected. */
const NO_SLOT:u32=0xffffffffu;
var<workgroup> laneSlots:array<u32,64>;
var<workgroup> slotTally:array<atomic<u32>,${slots}>;
/** The slot item \`i\` draws in, or \`NO_SLOT\` when it lies at or past \`end\` or is not selected. */
fn slotAt(i:u32,end:u32)->u32{
 if(i>=end){return NO_SLOT;}
 let item=items[i];
 if(!selected(item)){return NO_SLOT;}
 return slotOf(i,item);
}
@compute @workgroup_size(64)
fn countGroups(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){
 let group=wg.x;
 if(group>=uni.groupCount){return;}
 for(var slot=lane;slot<${slots}u;slot+=64u){atomicStore(&slotTally[slot],0u);}
 workgroupBarrier();
 let s=slotAt(group*64u+lane,min(uni.count,uni.slotCap));
 if(s!=NO_SLOT){atomicAdd(&slotTally[s],1u);}
 workgroupBarrier();
 for(var slot=lane;slot<${slots}u;slot+=64u){
  groupCounts[group*${slots}u+slot]=select(atomicLoad(&slotTally[slot]),0u,slotUsed[slot]==0u);
 }
}
${LANE_SCAN_WGSL}@compute @workgroup_size(64)
fn prefixGroups(@builtin(local_invocation_index) lane:u32){
 if(uni.count>uni.slotCap){
  for(var slot=lane;slot<${slots}u;slot+=64u){writeCmd(slot,0u);}
  return;
 }
 let run=(uni.groupCount+63u)/64u;
 let first=min(lane*run,uni.groupCount);let last=min(first+run,uni.groupCount);
 var start=0u;
 for(var slot=0u;slot<${slots}u;slot++){
  let used=slotUsed[slot]!=0u;
  var sum=0u;
  if(used){for(var group=first;group<last;group++){sum=sum+groupCounts[group*${slots}u+slot];}}
  // Inclusive scan of the run totals over the lanes.
  let inclusive=laneScan(lane,sum);
  let total=laneSums[63u];
  if(used){
   var cursor=start+inclusive-sum;
   for(var group=first;group<last;group++){
    let entry=group*${slots}u+slot;
    groupOffsets[entry]=cursor;
    cursor=cursor+groupCounts[entry];
   }
  }
  if(lane==0u){writeCmd(slot,total);}
  start=start+total;
  workgroupBarrier();
 }
}
@compute @workgroup_size(64)
fn scatterGroups(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){
 if(uni.count>uni.slotCap){return;}
 let group=wg.x;let i=group*64u+lane;
 // The rank is the count of EARLIER lanes of the group in the same slot: the item's place in
 // the group's stable order.
 let s=slotAt(i,uni.count);
 laneSlots[lane]=s;
 workgroupBarrier();
 if(s==NO_SLOT){return;}
 var rank=0u;
 for(var j=0u;j<lane;j++){if(laneSlots[j]==s){rank=rank+1u;}}
 instances[groupOffsets[group*${slots}u+s]+rank]=items[i].pageIndex;
}
`;
};

/** The shader a scene with no stacked coplanar surface uses: the six slots of the single layer. */
export const DRAW_SHADER = drawShader(1);
