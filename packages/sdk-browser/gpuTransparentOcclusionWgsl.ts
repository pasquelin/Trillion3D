import { BOX_PROJECT_WGSL, PARTITION_UNI_WGSL } from './gpuBoxProjectWgsl.ts';
import { HIZ_FAR_WGSL, HIZ_LEVEL_WGSL } from './gpuHizRectWgsl.ts';
import { PARTITION_WORKGROUP } from './gpuPartitionContract.ts';

/**
 * Le test d'occultation des grappes transparentes, une entrée de la table par fil.
 *
 * C'est la MÊME règle que celle des opaques, à la lettre : la même projection conservatrice
 * (`projectBox`), le même uniforme — le tampon que la partition a écrit pour cette image-ci —, le
 * même choix de mip (`hizLevelFor`) et le même dépouillement de la pyramide (`pyramidFar`), sur la
 * pyramide Hi-Z que l'image vient de construire. Rien n'y est propre aux transparents sauf ce que
 * la fidélité exige :
 *
 *  - le biais de couche coplanaire est celui de la couche la PLUS HAUTE que l'image nomme, pour
 *    toutes les entrées. Une grappe n'annonce pas la sienne ici, et le biais ne fait que RAPPROCHER
 *    la borne de profondeur : le prendre maximal rejette moins, jamais plus ;
 *  - une boîte qui coupe le plan proche, un rectangle vide hors écran, une image sans pyramide
 *    (`uni.levels == 0`) et une empreinte qu'aucun mip ne couvre ne rejettent rien du tout ;
 *  - le verdict est écrit pour CHAQUE entrée à chaque image, jamais accumulé : une image qui
 *    n'encode pas ce noyau n'en laisse aucun reste (l'appelant remet alors le tampon à zéro).
 *
 * Le verdict ne retire que des grappes ENTIÈREMENT derrière l'opaque déjà dessiné. Il ne réordonne
 * rien : la compaction garde l'ordre de sa table, dont les entrées rejetées sortent comme sortent
 * celles que la coupe n'a pas sélectionnées.
 */
export function transparentOcclusionShader(entryCount: number) {
  return `${PARTITION_UNI_WGSL}@group(0) @binding(0) var<storage, read> corners:array<f32>;
@group(0) @binding(1) var<storage, read> pyramid:array<f32>;
@group(0) @binding(2) var<storage, read_write> occluded:array<u32>;
@group(0) @binding(3) var<uniform> uni:Uni;
${BOX_PROJECT_WGSL}
${HIZ_LEVEL_WGSL}
${HIZ_FAR_WGSL}
@compute @workgroup_size(${PARTITION_WORKGROUP})
fn testTransparentClusters(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=${Math.max(1, entryCount)}u){return;}
 var reject=0u;
 let box=projectBox(i,uni.layerTop);
 if(box.clips==0u&&uni.levels>0u){
  // Le rectangle découpé au viewport, exprimé en texels du mip qui le couvre : miroir exact de
  // l'empaquetage des bornes de la moitié testée opaque (\`gpuPartitionClassifyWgsl.ts\`).
  let x0=max(box.rect.x,0);let y0=max(box.rect.y,0);
  let x1=min(box.rect.z,i32(uni.width)-1);let y1=min(box.rect.w,i32(uni.height)-1);
  if(x1>=x0&&y1>=y0){
   let pick=hizLevelFor(vec4i(x0,y0,x1,y1),uni.levels);
   if(pick.y!=0u){
    let l=pick.x;
    let far=pyramidFar(x0>>l,y0>>l,x1>>l,y1>>l,
     uni.levelOffset[l>>2u][l&3u],uni.levelWidth[l>>2u][l&3u]);
    reject=select(0u,1u,box.nearest<far);
   }
  }
 }
 occluded[i]=reject;
}
`;
}
