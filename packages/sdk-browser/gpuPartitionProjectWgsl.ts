import {
  FLAG_CLIP,
  FLAG_HISTORY,
  FLAG_PREV_REST,
  PARTITION_WORKGROUP,
  ROW_DATA_U32,
  ROW_FLAGS,
  ROW_KEY,
  ROW_NEAREST,
  HISTO_BITS,
  STATE_HISTO,
  ST_HISTORY_OCCLUDERS,
  VERDICT_REJECTED,
  ST_IN_FRONT,
} from './gpuPartitionContract.ts';

/**
 * Projection of a resident row, and what the frame keeps of it: the occluder history, the row's
 * rectangle and depth bound, and the view-depth histogram.
 *
 * The arithmetic itself is `projectBox` (`gpuBoxProjectWgsl.ts`), shared with the transparent-cluster
 * occlusion test: that is what carries the conservativeness proof, and this kernel only stores what
 * it returns.
 */
export const PARTITION_PROJECT_WGSL = `
@compute @workgroup_size(${PARTITION_WORKGROUP})
fn projectRows(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.rows){return;}
 let base=i*${ROW_DATA_U32}u;
 // Occluder history from the previous frame: a row drawn without being occluded — occluder half,
 // or tested half whose Hi-Z verdict was "visible" — occludes for the next. This is last frame's
 // verdict, read before this frame's Hi-Z test clears it.
 let held=rowData[base+${ROW_FLAGS}u];
 var drawn=1u;
 if((held&${FLAG_PREV_REST}u)!=0u){drawn=select(1u,0u,flags[i]==${VERDICT_REJECTED}u);}
 if(drawn!=0u){atomicAdd(&state[${ST_HISTORY_OCCLUDERS}u],1u);}
 let box=projectBox(i,items[i].layer);
 if(box.clips==0u){
  atomicAdd(&state[${ST_IN_FRONT}u],1u);
  atomicAdd(&state[${STATE_HISTO}u+(depthKey(box.lowView)>>${32 - HISTO_BITS}u)],1u);
 }
 rowData[base]=bitcast<u32>(box.rect.x);
 rowData[base+1u]=bitcast<u32>(box.rect.y);
 rowData[base+2u]=bitcast<u32>(box.rect.z);
 rowData[base+3u]=bitcast<u32>(box.rect.w);
 rowData[base+${ROW_NEAREST}u]=bitcast<u32>(box.nearest);
 rowData[base+${ROW_FLAGS}u]=
  select(0u,${FLAG_CLIP}u,box.clips!=0u)|select(0u,${FLAG_HISTORY}u,drawn!=0u);
 rowData[base+${ROW_KEY}u]=depthKey(box.lowView);
}
`;
