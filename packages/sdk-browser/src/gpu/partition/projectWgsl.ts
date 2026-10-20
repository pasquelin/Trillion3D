import {
  FLAG_CLIP,
  FLAG_HISTORY,
  FLAG_PREV_REST,
  FLAG_PROJECTED,
  ROW_DATA_U32,
  ROW_FLAGS,
  ROW_NEAREST,
  ROW_RECT_WGSL,
  ST_HISTORY_OCCLUDERS,
  ST_WITHDRAWN,
  VERDICT_REJECTED,
  STATE_TALLY_WGSL,
} from './contract.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../dispatch/grid.ts'
import { BOX_PROJECT_WGSL } from '../core/boxProjectWgsl.ts'
import { HIZ_HIDDEN_WGSL } from '../hiz/rectWgsl.ts'

/**
 * Projection of a resident row, and what the frame keeps of it: the occluder history, the row's
 * rectangle and depth bound.
 *
 * **The main-pass cull of the published two-phase design.** A row is an occluder of this image
 * when it was drawn by the previous one — occluder half, or tested half whose verdict was
 * "visible" — AND the previous image's pyramid does not hide it: the rectangle and depth bound
 * the row held from that image, projected with that image's matrices and jitter, are read
 * against that image's pyramid, still in its buffer since this image has not yet rebuilt it. A
 * row the pyramid hides leaves the occluders for the tested half, where THIS image's pyramid
 * judges it again, conservatively, before the second pass. Without this test the occluder set
 * only ever grows — a cluster once seen would be drawn every image, however deeply the camera
 * has since buried it — and the second pass would have nothing left to cull.
 *
 * The test reads nothing that can lose a pixel: a wrong verdict here only moves a row to the
 * other half, and the halves decide draw order. That is why the previous image's data need
 * little validation — a moved world, a resized target: the held rectangle is stale, the row is
 * at worst tested twice, and the image is the same. A rank the table rewrote reaches this kernel
 * with its words cleared (`forgetRows`): zero flags are a row never projected, whose history
 * must not pass from one page to the next.
 *
 * The arithmetic itself is `projectBox` (`../core/boxProjectWgsl.ts`), shared with the transparent-
 * cluster occlusion test: that is what carries the conservativeness proof, and this kernel only
 * stores what it returns.
 */
export const PARTITION_PROJECT_WGSL = wgslBlock(
  'PARTITION_PROJECT_WGSL',
  [
    STATE_TALLY_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    BOX_PROJECT_WGSL,
    HIZ_HIDDEN_WGSL,
    ROW_RECT_WGSL,
  ],
  `
@compute @workgroup_size(WORKGROUP_THREADS)
fn projectRows(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){
 let row=flatIndex(id,n,WORKGROUP_THREADS);
 if(row<uni.rows){projectRow(row);}
 flushTally(lane);
}
fn projectRow(i:u32){
 let base=i*${ROW_DATA_U32}u;
 // Last image's flags, read before this kernel rewrites them below. A row rewritten since
 // then was cleared before this pass: its zero flags read as never projected.
 let held=rowData[base+${ROW_FLAGS}u];
 var drawn=1u;
 if((held&${FLAG_PREV_REST}u)!=0u){drawn=select(1u,0u,flags[i]==${VERDICT_REJECTED}u);}
 if(drawn!=0u){tallyAdd(${ST_HISTORY_OCCLUDERS}u,1u);}
 // A frame with no tested half has nowhere to send a withdrawn row; a rectangle never projected
 // or cut by the near plane is nothing the pyramid can judge.
 let judged=(held&(${FLAG_PROJECTED}u|${FLAG_CLIP}u))==${FLAG_PROJECTED}u;
 if(drawn!=0u&&uni.hasRest!=0u&&judged){
  if(hiddenByPyramid(rowRect(base),bitcast<f32>(rowData[base+${ROW_NEAREST}u]))){
   drawn=0u;
   tallyAdd(${ST_WITHDRAWN}u,1u);
  }
 }
 let box=projectBox(i,items[i].layer);
 rowData[base]=bitcast<u32>(box.rect.x);
 rowData[base+1u]=bitcast<u32>(box.rect.y);
 rowData[base+2u]=bitcast<u32>(box.rect.z);
 rowData[base+3u]=bitcast<u32>(box.rect.w);
 rowData[base+${ROW_NEAREST}u]=bitcast<u32>(box.nearest);
 rowData[base+${ROW_FLAGS}u]=${FLAG_PROJECTED}u|select(0u,${FLAG_CLIP}u,box.clips!=0u)
  |select(0u,${FLAG_HISTORY}u,drawn!=0u);
}
`,
)
