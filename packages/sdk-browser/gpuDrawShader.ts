import { BASE_SLOTS, slotCount } from './gpuDrawContract.ts';

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
 * remove items. Such a slot leaves the counting pass at once and is skipped by the prefix too, so
 * a coplanar layer that no cluster of the batch — or of this half of the image — reaches costs the
 * compaction nothing at all.
 *
 * Le préfixe répartit les slots sur les soixante-quatre fils d'un seul groupe de travail plutôt que
 * de les parcourir l'un après l'autre : chaque fil totalise les slots qui lui reviennent par pas de
 * 64, une barrière de groupe de travail sépare cette phase du calcul des décalages, puis chaque fil
 * reconstruit son curseur en resommant les totaux des slots qui le précèdent. Le résultat est celui
 * du parcours en série terme pour terme — l'addition en u32 est associative, et le curseur d'un slot
 * ne dépend que des totaux des slots d'indice inférieur, qu'un slot inutilisé laisse à zéro.
 * `bench/oracles/gpuDrawPrefixOracle.ts` porte les deux noyaux et `gpuDrawPrefixEquivalence.test.ts`
 * la preuve.
 */
export const drawShader = (layerSlots: number) => {
  const slots = slotCount(layerSlots);
  const top = Math.max(0, Math.max(1, layerSlots) - 1);
  return `struct DrawItem{pageIndex:u32,bin:u32,selectionIndex:u32,layer:u32,}
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
fn slotOf(i:u32,item:DrawItem)->u32{return restAt(i)*3u+item.bin+${BASE_SLOTS}u*min(item.layer,${top}u);}
fn matches(i:u32,slot:u32)->bool{let item=items[i];return slotOf(i,item)==slot&&selected(item);}
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
 if(entry>=uni.groupCount*${slots}u){return;}
 let group=entry/${slots}u;let slot=entry%${slots}u;
 if(slotUsed[slot]==0u){groupCounts[entry]=0u;return;}
 var count=0u;
 let begin=group*64u;let end=min(begin+64u,min(uni.count,uni.slotCap));
 for(var i=begin;i<end;i++){if(matches(i,slot)){count=count+1u;}}
 groupCounts[entry]=count;
}
var<workgroup> slotTotals:array<u32,${slots}>;
@compute @workgroup_size(64)
fn prefixGroups(@builtin(local_invocation_id) lid:vec3u){
 let lane=lid.x;
 for(var slot=lane;slot<${slots}u;slot+=64u){slotTotals[slot]=0u;}
 if(uni.count>uni.slotCap){
  for(var slot=lane;slot<${slots}u;slot+=64u){writeCmd(slot,0u);}
  return;
 }
 for(var slot=lane;slot<${slots}u;slot+=64u){
  if(slotUsed[slot]==0u){writeCmd(slot,0u);continue;}
  var total=0u;
  for(var group=0u;group<uni.groupCount;group++){total=total+groupCounts[group*${slots}u+slot];}
  slotTotals[slot]=total;
  writeCmd(slot,total);
 }
 workgroupBarrier();
 for(var slot=lane;slot<${slots}u;slot+=64u){
  if(slotUsed[slot]==0u){continue;}
  var cursor=0u;
  for(var before=0u;before<slot;before++){cursor=cursor+slotTotals[before];}
  for(var group=0u;group<uni.groupCount;group++){
   let entry=group*${slots}u+slot;
   groupOffsets[entry]=cursor;
   cursor=cursor+groupCounts[entry];
  }
 }
}
@compute @workgroup_size(64)
fn scatterGroups(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 if(i>=uni.count||uni.count>uni.slotCap){return;}
 let item=items[i];if(!selected(item)){return;}let slot=slotOf(i,item);
 let group=i/64u;let begin=group*64u;
 var rank=0u;
 for(var j=begin;j<i;j++){if(matches(j,slot)){rank=rank+1u;}}
 instances[groupOffsets[group*${slots}u+slot]+rank]=item.pageIndex;
}
`;
};

/** The shader a scene with no stacked coplanar surface uses: the six slots of the single layer. */
export const DRAW_SHADER = drawShader(1);
