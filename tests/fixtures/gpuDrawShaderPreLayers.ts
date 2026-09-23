/**
 * Verbatim body of the `DRAW_SHADER` template literal from `packages/sdk-browser/src/gpu/draw/shader.ts`
 * at commit 5ae3b83, the last commit to touch that file before the coplanar depth layers landed.
 *
 * A versioned fixture replaces a `git show` at test time: once the layers are merged, `develop`
 * carries the version after them, so comparing against the branch would compare the file to itself.
 * This is a fixed point instead, exactly as the comment it replaces intended.
 */
export const PRE_LAYERS_GPU_DRAW_SHADER_SOURCE = `struct DrawItem{pageIndex:u32,bin:u32,selectionIndex:u32,pad0:u32,}
struct Uniforms{count:u32,maxVertexCount:u32,slotCap:u32,groupCount:u32,selectionEnabled:u32,selectionOffset:u32,pad0:u32,pad1:u32,}
@group(0) @binding(0) var<storage, read> items:array<DrawItem>;
@group(0) @binding(1) var<uniform> uni:Uniforms;
@group(0) @binding(2) var<storage, read_write> instances:array<u32>;
@group(0) @binding(3) var<storage, read_write> indirect:array<u32>;
@group(0) @binding(4) var<storage, read_write> groupCounts:array<u32>;
@group(0) @binding(5) var<storage, read_write> groupOffsets:array<u32>;
@group(0) @binding(6) var<storage, read> selectionMask:array<u32>;
@group(0) @binding(7) var<storage, read> restBits:array<u32>;
// The occluder/rest partition is the only per-frame word of an item, so it travels as one bit each.
fn restAt(i:u32)->u32{return (restBits[i>>5u]>>(i&31u))&1u;}
fn selected(item:DrawItem)->bool{
 if(uni.selectionEnabled==0u){return true;}
 return selectionMask[uni.selectionOffset+item.selectionIndex]!=0u;
}
fn matches(i:u32,slot:u32)->bool{let item=items[i];return restAt(i)*3u+item.bin==slot&&selected(item);}
fn writeCmd(slot:u32,count:u32){
 let o=slot*4u;
 indirect[o]=uni.maxVertexCount;
 indirect[o+1u]=count;
 indirect[o+2u]=0u;
 indirect[o+3u]=0u;
}
@compute @workgroup_size(64)
fn countGroups(@builtin(global_invocation_id) id:vec3u){
 let entry=id.x;
 if(entry>=uni.groupCount*6u){return;}
 let group=entry/6u;let slot=entry%6u;
 var count=0u;
 let begin=group*64u;let end=min(begin+64u,min(uni.count,uni.slotCap));
 for(var i=begin;i<end;i++){if(matches(i,slot)){count=count+1u;}}
 groupCounts[entry]=count;
}
@compute @workgroup_size(1)
fn prefixGroups(){
 if(uni.count>uni.slotCap){
  writeCmd(0u,0u);writeCmd(1u,0u);writeCmd(2u,0u);
  writeCmd(3u,0u);writeCmd(4u,0u);writeCmd(5u,0u);
  return;
 }
 var slotStart=0u;
 for(var slot=0u;slot<6u;slot++){
  var total=0u;
  for(var group=0u;group<uni.groupCount;group++){total=total+groupCounts[group*6u+slot];}
  var cursor=slotStart;
  for(var group=0u;group<uni.groupCount;group++){
   let entry=group*6u+slot;
   groupOffsets[entry]=cursor;
   cursor=cursor+groupCounts[entry];
  }
  writeCmd(slot,total);
  slotStart=slotStart+total;
 }
}
@compute @workgroup_size(64)
fn scatterGroups(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 if(i>=uni.count||uni.count>uni.slotCap){return;}
 let item=items[i];if(!selected(item)){return;}let slot=restAt(i)*3u+item.bin;
 let group=i/64u;let begin=group*64u;
 var rank=0u;
 for(var j=begin;j<i;j++){if(matches(j,slot)){rank=rank+1u;}}
 instances[groupOffsets[group*6u+slot]+rank]=item.pageIndex;
}
`;
