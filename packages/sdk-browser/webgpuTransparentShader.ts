import { TRANSPARENT_GROUP, TRANSPARENT_NONE } from './webgpuTransparentTable.ts';

/**
 * Stable compaction of the transparent clusters an image selected, one indirect command per item.
 *
 * The input is the scene's static draw order (`webgpuTransparentTable`); the only per-image input is
 * the selection mask the cluster cut wrote this very frame. A count per group, a serial prefix over
 * the groups of each item, then a scatter that places each surviving cluster at its rank inside its
 * group: the output is the input order with the unselected entries removed, which is exactly the
 * list the CPU used to sort by `sourceOrder` every frame.
 *
 * Item ranges are aligned on the group, so no group spans two items and each item's instances are
 * written inside its own range — the base a draw reads is known before the image starts.
 *
 * An entry leaves the list for two reasons only: the cut did not select it, or the transparent Hi-Z
 * test found it ENTIRELY behind the already-drawn opaque (`gpuTransparentOcclusionWgsl.ts`). Neither
 * reorders anything: the output stays the table order, stripped of its dropped entries.
 */
export const TRANSPARENT_COMPACT_SHADER = `struct Uniforms{entryCount:u32,groupCount:u32,itemCount:u32,selectionOffset:u32,vertexCount:u32,pad0:u32,pad1:u32,pad2:u32,}
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
 if(cluster==${TRANSPARENT_NONE}u){return false;}
 if(occluded[i]!=0u){return false;}
 return selectionMask[uni.selectionOffset+cluster]!=0u;
}
@compute @workgroup_size(64)
fn countTransparentGroups(@builtin(global_invocation_id) id:vec3u){
 let group=id.x;
 if(group>=uni.groupCount){return;}
 let begin=group*${TRANSPARENT_GROUP}u;
 let end=min(begin+${TRANSPARENT_GROUP}u,uni.entryCount);
 var count=0u;
 for(var i=begin;i<end;i++){if(selected(i)){count=count+1u;}}
 groupCounts[group]=count;
}
@compute @workgroup_size(64)
fn prefixTransparentItems(@builtin(global_invocation_id) id:vec3u){
 let item=id.x;
 if(item>=uni.itemCount){return;}
 let base=itemRanges[item*2u];
 let held=itemRanges[item*2u+1u];
 let first=base/${TRANSPARENT_GROUP}u;
 let groups=(held+${TRANSPARENT_GROUP}u-1u)/${TRANSPARENT_GROUP}u;
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
@compute @workgroup_size(64)
fn scatterTransparentGroups(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 if(i>=uni.entryCount||!selected(i)){return;}
 let group=i/${TRANSPARENT_GROUP}u;
 let begin=group*${TRANSPARENT_GROUP}u;
 var rank=0u;
 for(var j=begin;j<i;j++){if(selected(j)){rank=rank+1u;}}
 instances[groupOffsets[group]+rank]=i;
}
`;
