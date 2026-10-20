import { HIZ_KERNEL_TEXELS } from '../../hiz/counts.ts'
import {
  FLAG_CLIP,
  FLAG_HISTORY,
  FLAG_PREV_REST,
  VERDICT_KEPT,
  VERDICT_OCCLUDER,
  ROW_DATA_U32,
  ROW_FLAGS,
  ROW_NEAREST,
  ROW_RECT_WGSL,
  ST_OCCLUDERS,
  ST_OVERSIZED,
  ST_OVERSIZED_TRIANGLES,
  ST_TESTED,
  ST_TESTED_TRIANGLES,
  TESTED_BOX,
  STATE_TALLY_WGSL,
} from './contract.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { bitMask, bitWord } from '../../../../math/src/wgsl/integer.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../dispatch/grid.ts'
import { HIZ_LEVEL_WGSL } from '../hiz/rectWgsl.ts'
import { DRAW_MASK_WGSL } from '../dag/shader/drawMaskWgsl.ts'

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
 *
 * The test, and the counters that weigh it, take only the rows the cut draws (`maskSelects`, the
 * draw compaction's mask): a resident row the cut leaves undrawn — a parent, a child, a page kept
 * cached — launches nothing whatever its verdict, and its triangles are none of the cut's. Kept,
 * it is no reject of the image: the rejected triangles are those of the cut alone, which the
 * drawn count takes off the selected ones (`drawnTrianglesOf`).
 */
export const PARTITION_CLASSIFY_WGSL = wgslBlock(
  'PARTITION_CLASSIFY_WGSL',
  [
    STATE_TALLY_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    HIZ_LEVEL_WGSL,
    ROW_RECT_WGSL,
    DRAW_MASK_WGSL,
    bitWord,
    bitMask,
  ],
  `
@compute @workgroup_size(WORKGROUP_THREADS)
fn classifyRows(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){
 let row=flatIndex(id,n,WORKGROUP_THREADS);
 if(row<uni.rows){classifyRow(row);}
 flushTally(lane);
}
fn classifyRow(i:u32){
 let base=i*${ROW_DATA_U32}u;
 let held=rowData[base+${ROW_FLAGS}u];
 let clips=(held&${FLAG_CLIP}u)!=0u;
 let rest=select(0u,1u,uni.hasRest!=0u&&(held&${FLAG_HISTORY}u)==0u);
 rowData[base+${ROW_FLAGS}u]=(held&~${FLAG_PREV_REST}u)|select(0u,${FLAG_PREV_REST}u,rest!=0u);
 // Verdict the compute raster reads: a row's half, before any occlusion test.
 flags[i]=select(${VERDICT_OCCLUDER}u,${VERDICT_KEPT}u,rest!=0u);
 if(rest==0u){tallyAdd(${ST_OCCLUDERS}u,1u);return;}
 atomicOr(&restBits[bitWord(i)],bitMask(i));
 let item=items[i];
 // A row the cut does not draw is never tested, nor counted: it stays at the kept verdict above.
 if(uni.selectionEnabled!=0u&&!maskSelects(item.selectionIndex)){return;}
 // Only a box the pyramid can judge travels to the test, naming the row it answers for, its
 // rectangle the one pick (\`hizRectPick\`) in texels of its mip: a row cut by the near plane, off
 // screen or wider than every mip stays at the kept verdict written above.
 let unclipped=rowRect(base);
 let p=hizRectPick(select(unclipped,vec4i(0,0,-1,-1),clips));
 if(p.found){
  let l=p.level;let fine=hizMip(l);let coarse=hizMip(p.coarse);
  let slot=atomicAdd(&state[${ST_TESTED}u],1u)*${TESTED_BOX.words}u;
  tested[slot+${TESTED_BOX.at.minX}u]=bitcast<u32>(p.rect.x>>l);
  tested[slot+${TESTED_BOX.at.minY}u]=bitcast<u32>(p.rect.y>>l);
  tested[slot+${TESTED_BOX.at.maxX}u]=bitcast<u32>(p.rect.z>>l);
  tested[slot+${TESTED_BOX.at.maxY}u]=bitcast<u32>(p.rect.w>>l);
  tested[slot+${TESTED_BOX.at.nearest}u]=rowData[base+${ROW_NEAREST}u];
  tested[slot+${TESTED_BOX.at.row}u]=i;
  tested[slot+${TESTED_BOX.at.fineOffset}u]=fine.x;
  tested[slot+${TESTED_BOX.at.fineWidth}u]=fine.y;
  tested[slot+${TESTED_BOX.at.triangles}u]=item.triangles;
  tested[slot+${TESTED_BOX.at.coarseOffset}u]=coarse.x;
  tested[slot+${TESTED_BOX.at.coarseWidth}u]=coarse.y;
  tested[slot+${TESTED_BOX.at.coarseShift}u]=p.coarse-l;
 }
 tallyAdd(${ST_TESTED_TRIANGLES}u,item.triangles);
 // A footprint wider than the level-0 kernel answers from a coarser mip: it is counted on the
 // UNCLIPPED rectangle, like \`hizOversized\`.
 if(!clips&&(unclipped.z-unclipped.x>=${HIZ_KERNEL_TEXELS}||unclipped.w-unclipped.y>=${HIZ_KERNEL_TEXELS})){
  tallyAdd(${ST_OVERSIZED}u,1u);
  tallyAdd(${ST_OVERSIZED_TRIANGLES}u,item.triangles);
 }
}
`,
)
