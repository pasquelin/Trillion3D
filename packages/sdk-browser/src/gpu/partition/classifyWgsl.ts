import { BASE_SLOTS } from '../draw/contract.ts';
import { HIZ_KERNEL_TEXELS } from '../../hiz/counts.ts';
import {
  FLAG_CLIP,
  FLAG_HISTORY,
  FLAG_PREV_REST,
  VERDICT_KEPT,
  VERDICT_OCCLUDER,
  PARTITION_WORKGROUP,
  ROW_DATA_U32,
  ROW_FLAGS,
  ROW_NEAREST,
  ST_OCCLUDERS,
  ST_OVERSIZED,
  ST_OVERSIZED_TRIANGLES,
  ST_TESTED,
  ST_TESTED_TRIANGLES,
  TESTED_U32,
} from './contract.ts';

/**
 * Occluder/tested split and packing of the Hi-Z test bounds, per resident row.
 *
 * The split is the one `projectRows` just decided, row by row, from what the previous image
 * drew and what its pyramid hid: an occluder draws in the first pass, everything else goes to
 * the tested half. No rule of the frame's own — no median, no threshold — enters here: a first
 * image, a fresh buffer, an image after a lost pyramid all draw everything in one pass, and the
 * next image has a pyramid to cull with. The partition only decides DRAW ORDER; a pixel can
 * change only through the Hi-Z test, whose depth bound and rectangle stay conservative whichever
 * half the row falls in.
 */
export const PARTITION_CLASSIFY_WGSL = `
@compute @workgroup_size(${PARTITION_WORKGROUP})
fn classifyRows(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.rows){return;}
 let base=i*${ROW_DATA_U32}u;
 let held=rowData[base+${ROW_FLAGS}u];
 let clips=(held&${FLAG_CLIP}u)!=0u;
 let rest=select(0u,1u,uni.hasRest!=0u&&(held&${FLAG_HISTORY}u)==0u);
 rowData[base+${ROW_FLAGS}u]=(held&~${FLAG_PREV_REST}u)|select(0u,${FLAG_PREV_REST}u,rest!=0u);
 // Verdict the compute raster reads: a row's half, before any occlusion test.
 flags[i]=select(${VERDICT_OCCLUDER}u,${VERDICT_KEPT}u,rest!=0u);
 if(rest!=0u){atomicOr(&restBits[i>>5u],1u<<(i&31u));}
 else{atomicAdd(&state[${ST_OCCLUDERS}u],1u);}
 let item=items[i];
 atomicAdd(&slotUsed[rest*3u+item.bin+${BASE_SLOTS}u*min(item.layer,uni.layerTop)],1u);
 if(rest==0u){return;}
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
