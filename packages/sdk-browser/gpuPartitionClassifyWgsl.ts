import { BASE_SLOTS } from './gpuDrawContract.ts';
import { HIZ_KERNEL_TEXELS } from './hizCounts.ts';
import {
  FLAG_CLIP,
  FLAG_HISTORY,
  FLAG_PREV_REST,
  HISTO_BITS,
  HISTO_BLOCK,
  HISTO_BUCKETS,
  MODE_HISTORY,
  MODE_MEDIAN,
  VERDICT_KEPT,
  VERDICT_OCCLUDER,
  PARTITION_WORKGROUP,
  ROW_DATA_U32,
  ROW_FLAGS,
  ROW_KEY,
  ROW_NEAREST,
  STATE_HISTO,
  ST_HISTORY_OCCLUDERS,
  ST_IN_FRONT,
  ST_MODE,
  ST_OCCLUDERS,
  ST_OVERSIZED,
  ST_OVERSIZED_TRIANGLES,
  ST_TESTED,
  ST_TESTED_TRIANGLES,
  ST_THRESHOLD,
  ST_TWO_PASS,
  TESTED_U32,
} from './gpuPartitionContract.ts';

/**
 * Occluder/tested split and packing of the Hi-Z test bounds, per resident row.
 *
 * **The split rule changes, and cannot change the frame.** The CPU ranked by an exact median of
 * normalised depths (radix rank selection, `splitOccludersFlat`). Here the frame itself
 * histograms the VIEW depths of its boxes over four thousand and ninety-six buckets, and the
 * bucket the median rank falls in becomes the threshold: the whole boundary bucket goes to the
 * occluders. The split is therefore no longer exactly a half, but it remains a split — and the
 * partition only decides DRAW ORDER. A pixel can change only through the Hi-Z test, whose depth
 * bound and rectangle stay conservative whichever half the row falls in.
 *
 * Occluder history is still preferred when it splits something, and it is still fed by the
 * previous frame's Hi-Z verdict: `projectRows` rereads `flags` before this frame's test clears
 * them. It is held PER ROW and no longer by cluster key, and the caller declares it stale as
 * soon as the row table changes age.
 */
export const PARTITION_CLASSIFY_WGSL = `
var<workgroup> blockTotals:array<u32,${PARTITION_WORKGROUP}>;
@compute @workgroup_size(${PARTITION_WORKGROUP})
fn chooseSplit(@builtin(local_invocation_id) lid:vec3u){
 // Two-level histogram sweep: each thread totals its buckets, then one thread walks the sixty-
 // four totals to find the block of the sought rank, and finally that block's buckets. The
 // result is that of a serial walk — u32 addition is associative.
 let lane=lid.x;
 var total=0u;
 for(var k=0u;k<${HISTO_BLOCK}u;k++){
  total+=atomicLoad(&state[${STATE_HISTO}u+lane*${HISTO_BLOCK}u+k]);
 }
 blockTotals[lane]=total;
 workgroupBarrier();
 if(lane==0u){
  let rows=uni.rows;
  let history=atomicLoad(&state[${ST_HISTORY_OCCLUDERS}u]);
  var mode=${MODE_MEDIAN}u;var threshold=${HISTO_BUCKETS - 1}u;var occluders=history;
  if(uni.historyValid!=0u&&history>0u&&history<rows){mode=${MODE_HISTORY}u;}
  else{
   // Sought rank among boxes that do not clip the near plane, like the CPU selection.
   let need=max(1u,atomicLoad(&state[${ST_IN_FRONT}u])/2u);
   var below=0u;var block=0u;
   loop{
    if(block>=${PARTITION_WORKGROUP}u-1u){break;}
    if(below+blockTotals[block]>=need){break;}
    below+=blockTotals[block];block++;
   }
   var digit=block*${HISTO_BLOCK}u;
   loop{
    if(digit>=(block+1u)*${HISTO_BLOCK}u-1u){break;}
    let n=atomicLoad(&state[${STATE_HISTO}u+digit]);
    if(below+n>=need){break;}
    below+=n;digit++;
   }
   threshold=digit;
   occluders=below+atomicLoad(&state[${STATE_HISTO}u+digit]);
  }
  atomicStore(&state[${ST_THRESHOLD}u],threshold);
  atomicStore(&state[${ST_MODE}u],mode);
  let split=uni.hasRest!=0u&&rows>=2u&&occluders>0u&&occluders<rows;
  atomicStore(&state[${ST_TWO_PASS}u],select(0u,1u,split));
 }
}
@compute @workgroup_size(${PARTITION_WORKGROUP})
fn classifyRows(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.rows){return;}
 let base=i*${ROW_DATA_U32}u;
 let held=rowData[base+${ROW_FLAGS}u];
 let clips=(held&${FLAG_CLIP}u)!=0u;
 let twoPass=atomicLoad(&state[${ST_TWO_PASS}u])!=0u;
 var rest=0u;
 if(twoPass){
  if(atomicLoad(&state[${ST_MODE}u])==${MODE_HISTORY}u){
   rest=select(1u,0u,(held&${FLAG_HISTORY}u)!=0u);
  }else{
   // A box that clips the near plane stays in the rest, where it hides no other.
   let bucket=rowData[base+${ROW_KEY}u]>>${32 - HISTO_BITS}u;
   rest=select(0u,1u,clips||bucket>atomicLoad(&state[${ST_THRESHOLD}u]));
  }
 }
 rowData[base+${ROW_FLAGS}u]=(held&~${FLAG_PREV_REST}u)|select(0u,${FLAG_PREV_REST}u,rest!=0u);
 // Verdict the compute raster reads: a row's half, before any occlusion test.
 flags[i]=select(${VERDICT_OCCLUDER}u,${VERDICT_KEPT}u,rest!=0u);
 if(rest!=0u){atomicOr(&restBits[i>>5u],1u<<(i&31u));}
 else{atomicAdd(&state[${ST_OCCLUDERS}u],1u);}
 let item=items[i];
 atomicAdd(&slotUsed[rest*3u+item.bin+${BASE_SLOTS}u*min(item.layer,uni.layerTop)],1u);
 if(rest==0u||!twoPass){return;}
 // Only the tested half travels to the kernel, each box naming the row it answers for.
 // The rectangle is already clipped to the viewport and expressed in texels of the mip that
 // covers it exactly: mirror of \`hizTestRect\` then of the packing the CPU did box by box.
 let unclipped=vec4i(bitcast<i32>(rowData[base]),bitcast<i32>(rowData[base+1u]),
  bitcast<i32>(rowData[base+2u]),bitcast<i32>(rowData[base+3u]));
 let x0=max(unclipped.x,0);let y0=max(unclipped.y,0);
 let x1=min(unclipped.z,i32(uni.width)-1);let y1=min(unclipped.w,i32(uni.height)-1);
 var level=0u;var found=false;
 if(!clips&&x1>=x0&&y1>=y0){
  let pick=hizLevelFor(vec4i(x0,y0,x1,y1),uni.levels);
  level=pick.x;found=pick.y!=0u;
 }
 let slot=atomicAdd(&state[${ST_TESTED}u],1u)*${TESTED_U32}u;
 if(found){
  tested[slot]=bitcast<u32>(x0>>level);
  tested[slot+1u]=bitcast<u32>(y0>>level);
  tested[slot+2u]=bitcast<u32>(x1>>level);
  tested[slot+3u]=bitcast<u32>(y1>>level);
  tested[slot+5u]=i<<1u;
  tested[slot+6u]=uni.levelOffset[level>>2u][level&3u];
  tested[slot+7u]=uni.levelWidth[level>>2u][level&3u];
 }else{
  tested[slot]=0u;tested[slot+1u]=0u;tested[slot+2u]=0u;tested[slot+3u]=0u;
  tested[slot+5u]=(i<<1u)|1u;
  tested[slot+6u]=0u;
  tested[slot+7u]=uni.width;
 }
 tested[slot+4u]=rowData[base+${ROW_NEAREST}u];
 tested[slot+8u]=item.triangles;
 atomicAdd(&state[${ST_TESTED_TRIANGLES}u],item.triangles);
 // A footprint wider than the level-0 kernel answers from a coarser mip: it is counted on the
 // UNCLIPPED rectangle, like \`hizOversized\`.
 if(!clips&&(unclipped.z-unclipped.x>=${HIZ_KERNEL_TEXELS}||unclipped.w-unclipped.y>=${HIZ_KERNEL_TEXELS})){
  atomicAdd(&state[${ST_OVERSIZED}u],1u);
  atomicAdd(&state[${ST_OVERSIZED_TRIANGLES}u],item.triangles);
 }
}
`;
