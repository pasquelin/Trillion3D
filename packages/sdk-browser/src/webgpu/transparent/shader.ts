import { TRANSPARENT_GROUP } from './table.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { ceilDivWgsl } from '../../../../math/src/wgsl/integer.ts'
import { DRAW_MASK_WGSL } from '../../gpu/dag/shader/drawMaskWgsl.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { LANE_SCAN_WGSL } from '../../gpu/core/laneScanWgsl.ts'

/**
 * Stable compaction of the transparent clusters an image selected, one indirect command per item.
 *
 * The input is the scene's static draw order (`webgpuTransparentTable`); the only per-image input is
 * the selection mask the cluster cut wrote this very frame. A group is a workgroup, a lane an entry:
 * its count by the engine's lane scan (`laneScan`), a serial prefix over the groups of each item,
 * then a scatter that places each surviving cluster at its rank inside its group, the same scan's: the output is the input order with the unselected entries removed, which is exactly the
 * list the CPU would sort by `sourceOrder` every frame.
 *
 * Item ranges are aligned on the group, so no group spans two items and each item's instances are
 * written inside its own range — the base a draw reads is known before the image starts.
 *
 * An entry leaves the list for two reasons only: the cut did not select it, or the transparent Hi-Z
 * test found it ENTIRELY behind the already-drawn opaque (`../../gpu/core/transparentOcclusionWgsl.ts`). Neither
 * reorders anything: the output stays the table order, stripped of its dropped entries.
 */
export const TRANSPARENT_COMPACT_SHADER = wgslProgram(
  `struct Uniforms{entryCount:u32,groupCount:u32,itemCount:u32,selectionOffset:u32,vertexCount:u32,pad0:u32,pad1:u32,pad2:u32,}
@group(0) @binding(0) var<storage, read> entries:array<u32>;
@group(0) @binding(1) var<uniform> uni:Uniforms;
@group(0) @binding(2) var<storage, read> selectionMask:array<u32>;
@group(0) @binding(3) var<storage, read_write> groupCounts:array<u32>;
@group(0) @binding(4) var<storage, read_write> groupOffsets:array<u32>;
@group(0) @binding(5) var<storage, read_write> instances:array<u32>;
@group(0) @binding(6) var<storage, read_write> indirect:array<u32>;
@group(0) @binding(7) var<storage, read> itemRanges:array<u32>;
@group(0) @binding(8) var<storage, read> occluded:array<u32>;
fn selected(i:u32)->bool{
 let cluster=entries[i];
 if(cluster==${NO_INDEX}u){return false;}
 if(occluded[i]!=0u){return false;}
 return maskSelects(cluster);
}
/** Whether lane \`lane\` of group \`group\` holds an entry the image keeps. */
fn keptInGroup(group:u32,lane:u32)->bool{
 let i=group*WORKGROUP_THREADS+lane;
 return i<uni.entryCount&&selected(i);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn countTransparentGroups(@builtin(workgroup_id) wg:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let group=flatIndex(wg,n,1u);
 if(group>=uni.groupCount){return;}
 let kept=laneScan(lane,select(0u,1u,keptInGroup(group,lane)));
 if(lane==WORKGROUP_THREADS-1u){groupCounts[group]=kept;}
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn prefixTransparentItems(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let item=flatIndex(id,n,WORKGROUP_THREADS);
 if(item>=uni.itemCount){return;}
 let base=itemRanges[item*2u];
 let held=itemRanges[item*2u+1u];
 let first=base/${TRANSPARENT_GROUP}u;
 let groups=ceilDiv(held,${TRANSPARENT_GROUP}u);
 var cursor=base;
 for(var g=0u;g<groups;g++){
  groupOffsets[first+g]=cursor;
  cursor=cursor+groupCounts[first+g];
 }
 let o=item*4u;
 indirect[o]=uni.vertexCount;
 indirect[o+1u]=cursor-base;
 indirect[o+2u]=0u;
 indirect[o+3u]=0u;
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn scatterTransparentGroups(@builtin(workgroup_id) wg:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let group=flatIndex(wg,n,1u);
 if(group>=uni.groupCount){return;}
 let kept=keptInGroup(group,lane);
 let rank=laneScan(lane,select(0u,1u,kept));
 if(kept){instances[groupOffsets[group]+rank-1u]=group*WORKGROUP_THREADS+lane;}
}
`,
  [FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL, ceilDivWgsl, DRAW_MASK_WGSL, LANE_SCAN_WGSL],
)
