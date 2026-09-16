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
  ST_IN_FRONT,
} from './gpuPartitionContract.ts';

/**
 * La projection d'une ligne résidente, et ce que l'image en garde : l'historique d'occulteurs, le
 * rectangle et la borne de profondeur de la ligne, et l'histogramme des profondeurs de vue.
 *
 * L'arithmétique elle-même est celle de `projectBox` (`gpuBoxProjectWgsl.ts`), partagée avec le test
 * d'occultation des grappes transparentes : c'est elle qui porte la démonstration de conservativité,
 * et ce noyau-ci ne fait que ranger ce qu'elle rend.
 */
export const PARTITION_PROJECT_WGSL = `
@compute @workgroup_size(${PARTITION_WORKGROUP})
fn projectRows(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.rows){return;}
 let base=i*${ROW_DATA_U32}u;
 // L'historique d'occulteurs de l'image précédente : une ligne dessinée sans être occultée — moitié
 // occulteurs, ou moitié testée dont le verdict Hi-Z fut « visible » — occulte pour la suivante.
 // C'est le verdict de l'image d'avant, lu avant que le test Hi-Z de celle-ci ne remette à zéro.
 let held=rowData[base+${ROW_FLAGS}u];
 var drawn=1u;
 if((held&${FLAG_PREV_REST}u)!=0u){drawn=select(1u,0u,flags[i]==1u);}
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
