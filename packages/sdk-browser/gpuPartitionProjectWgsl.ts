import {
  FLAG_CLIP,
  FLAG_HISTORY,
  FLAG_KEPT,
  FLAG_PREV_REST,
  FLAG_PROJECTED,
  PARTITION_WORKGROUP,
  ROW_DATA_U32,
  ROW_FLAGS,
  ROW_NEAREST,
  ST_HISTORY_OCCLUDERS,
  ST_WITHDRAWN,
  VERDICT_REJECTED,
} from './gpuPartitionContract.ts';

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
 * other half, and the halves decide draw order. That is why the previous image's data need no
 * validation — a rank that changed page, a moved world, a resized target: the held rectangle is
 * stale, the row is at worst tested twice, and the image is the same.
 *
 * One exception to the withdrawal, so that a still view converges: a row the test kept while the
 * view stood still keeps its place among the occluders until the view moves (`FLAG_KEPT`). The
 * antialiasing jitter shifts the raster by a fraction of a pixel each image, and a row at the
 * edge of an occluder is hidden under one jitter and seen under the next; withdrawn, kept,
 * withdrawn again, it would keep the counters moving and no image would ever be held. With the
 * exception every row settles — occluder, or tested and rejected — within one jitter cycle.
 *
 * The arithmetic itself is `projectBox` (`gpuBoxProjectWgsl.ts`), shared with the transparent-
 * cluster occlusion test: that is what carries the conservativeness proof, and this kernel only
 * stores what it returns.
 */
export const PARTITION_PROJECT_WGSL = `
@compute @workgroup_size(${PARTITION_WORKGROUP})
fn projectRows(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.rows){return;}
 let base=i*${ROW_DATA_U32}u;
 // Last image's verdict, read before this image's Hi-Z test clears it.
 let held=rowData[base+${ROW_FLAGS}u];
 var drawn=1u;
 // Kept by the test while the view stood still: an occluder until the view moves. Under the
 // antialiasing jitter a row at the edge of an occluder is hidden on one image and seen on the
 // next; without this the two halves would trade it every image, and no image would be held.
 var kept=uni.viewMoved==0u&&(held&${FLAG_KEPT}u)!=0u;
 if((held&${FLAG_PREV_REST}u)!=0u){
  let rejected=flags[i]==${VERDICT_REJECTED}u;
  drawn=select(1u,0u,rejected);
  if(!rejected&&uni.viewMoved==0u){kept=true;}
 }
 if(drawn!=0u){atomicAdd(&state[${ST_HISTORY_OCCLUDERS}u],1u);}
 // A frame with no tested half has nowhere to send a withdrawn row; a rectangle never projected
 // or cut by the near plane is nothing the pyramid can judge.
 let judged=(held&(${FLAG_PROJECTED}u|${FLAG_CLIP}u))==${FLAG_PROJECTED}u;
 if(drawn!=0u&&!kept&&uni.hasRest!=0u&&uni.levels>0u&&judged){
  let heldRect=vec4i(bitcast<i32>(rowData[base]),bitcast<i32>(rowData[base+1u]),
   bitcast<i32>(rowData[base+2u]),bitcast<i32>(rowData[base+3u]));
  if(hiddenByPyramid(heldRect,bitcast<f32>(rowData[base+${ROW_NEAREST}u]))){
   drawn=0u;
   atomicAdd(&state[${ST_WITHDRAWN}u],1u);
  }
 }
 let box=projectBox(i,items[i].layer);
 rowData[base]=bitcast<u32>(box.rect.x);
 rowData[base+1u]=bitcast<u32>(box.rect.y);
 rowData[base+2u]=bitcast<u32>(box.rect.z);
 rowData[base+3u]=bitcast<u32>(box.rect.w);
 rowData[base+${ROW_NEAREST}u]=bitcast<u32>(box.nearest);
 rowData[base+${ROW_FLAGS}u]=${FLAG_PROJECTED}u|select(0u,${FLAG_CLIP}u,box.clips!=0u)
  |select(0u,${FLAG_HISTORY}u,drawn!=0u)|select(0u,${FLAG_KEPT}u,kept);
}
`;
