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
 * Le partage occulteurs/testés et l'empaquetage des bornes du test Hi-Z, par ligne résidente.
 *
 * **La règle de partage change, et ne peut pas changer l'image.** Le processeur classait par une
 * médiane exacte des profondeurs normalisées (sélection de rang radix, `splitOccludersFlat`). Ici
 * l'image histogramme elle-même les profondeurs de VUE de ses boîtes sur quatre mille quatre-vingt-
 * seize seaux, et le seau où le rang médian tombe devient le seuil : tout le seau frontière part
 * chez les occulteurs. Le partage n'est donc plus exactement une moitié, mais il reste un partage —
 * et la partition ne décide que l'ORDRE de dessin. Un pixel ne peut changer que par le test Hi-Z,
 * dont la borne de profondeur et le rectangle restent conservateurs quelle que soit la moitié où la
 * ligne tombe.
 *
 * L'historique d'occulteurs reste préféré quand il partage quelque chose, et il reste alimenté par
 * le verdict Hi-Z de l'image précédente : `projectRows` relit `flags` avant que le test de cette
 * image-ci ne les remette à zéro. Il est tenu PAR LIGNE et non plus par clé de cluster, et
 * l'appelant le déclare caduc dès que la table de lignes change d'âge.
 */
export const PARTITION_CLASSIFY_WGSL = `
var<workgroup> blockTotals:array<u32,${PARTITION_WORKGROUP}>;
@compute @workgroup_size(${PARTITION_WORKGROUP})
fn chooseSplit(@builtin(local_invocation_id) lid:vec3u){
 // Balayage à deux niveaux de l'histogramme : chaque fil totalise ses seaux, puis un seul fil
 // parcourt les soixante-quatre totaux pour trouver le bloc du rang cherché, et enfin les seaux de
 // ce bloc. Le résultat est celui d'un parcours en série — l'addition en u32 est associative.
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
   // Le rang cherché parmi les boîtes qui ne coupent pas le plan proche, comme la sélection CPU.
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
   // Une boîte qui coupe le plan proche reste dans le reste, où elle n'en cache aucune autre.
   let bucket=rowData[base+${ROW_KEY}u]>>${32 - HISTO_BITS}u;
   rest=select(0u,1u,clips||bucket>atomicLoad(&state[${ST_THRESHOLD}u]));
  }
 }
 rowData[base+${ROW_FLAGS}u]=(held&~${FLAG_PREV_REST}u)|select(0u,${FLAG_PREV_REST}u,rest!=0u);
 // Le verdict que le raster de calcul lit : la moitié d'une ligne, avant tout test d'occultation.
 flags[i]=select(0u,2u,rest!=0u);
 if(rest!=0u){atomicOr(&restBits[i>>5u],1u<<(i&31u));}
 else{atomicAdd(&state[${ST_OCCLUDERS}u],1u);}
 let item=items[i];
 atomicAdd(&slotUsed[rest*3u+item.bin+${BASE_SLOTS}u*min(item.layer,uni.layerTop)],1u);
 if(rest==0u||!twoPass){return;}
 // Seule la moitié testée voyage jusqu'au noyau, chaque boîte nommant la ligne dont elle répond.
 // Le rectangle est déjà découpé au viewport et exprimé en texels du mip qui le couvre exactement :
 // miroir de \`hizTestRect\` puis de l'empaquetage que le processeur faisait boîte par boîte.
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
 // Une empreinte plus large que le noyau de niveau 0 répond depuis un mip plus grossier : elle se
 // compte sur le rectangle NON découpé, comme \`hizOversized\`.
 if(!clips&&(unclipped.z-unclipped.x>=${HIZ_KERNEL_TEXELS}||unclipped.w-unclipped.y>=${HIZ_KERNEL_TEXELS})){
  atomicAdd(&state[${ST_OVERSIZED}u],1u);
  atomicAdd(&state[${ST_OVERSIZED_TRIANGLES}u],item.triangles);
 }
}
`;
