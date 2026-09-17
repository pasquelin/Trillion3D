/**
 * L'ÉLAGAGE PAR LE HAUT : le plancher d'erreur du sous-arbre, et les deux mots par primitive qui le
 * rendent sûr sous l'escalade de résidence.
 *
 * Le nœud porte depuis le manifeste le PLAFOND d'erreur du remplaçant, de quoi écarter un sous-arbre
 * trop FIN. Il porte depuis `packCullingNodes` le PLANCHER de l'erreur propre, de quoi écarter aussi
 * le trop GROSSIER : au-dessus du seuil, aucune de ses grappes n'est assez fine, donc aucune ne
 * serait retenue et la descente n'a pas à les lister. C'est la moitié que la coupe processeur posait
 * déjà (`pageSelectionCutNode.ts`) et que la carte ne posait pas.
 *
 * DEUX MOTS PAR PRIMITIVE, parce que l'escalade de résidence monte le seuil APRÈS la descente. Un
 * étage grossier écarté au seuil de l'image est exactement celui que l'escalade réclamerait ensuite
 * pour remplacer une grappe absente : sans garde, la primitive n'aurait plus rien à dessiner.
 *
 * - `pruneSlot(w)` — le seuil auquel la descente élague. `dagPrepare` y porte le seuil FINAL de
 *   l'image précédente, qui vit encore dans `work[w]` au moment où il l'efface : une primitive qui
 *   escalade garde ses étages grossiers candidats tant qu'elle escalade, et redescend seule quand
 *   elle redevient complète. Aucun état de plus à tenir, aucune passe de plus.
 * - `floorSlot(w)` — le plus petit plancher que la descente a écarté. Si l'escalade passe au-dessus,
 *   `dagMask` arme le repli épinglé plutôt que de dessiner une couverture qu'il sait incomplète.
 *   Les grappes que rien ne remplace ne sont jamais élaguées (`NODE_HAS_ROOT`), si bien que ce repli
 *   a toujours de quoi couvrir la primitive.
 */
/** Les deux mots par primitive que l'élagage ajoute derrière les neuf compteurs d'image de `work` :
 *  son seuil, et le plus petit plancher qu'il a écarté. `gpuDagResources.ts` les alloue. */
export const LEVEL_WORLD_WORDS = 2;

import { NODE_HAS_ROOT } from './gpuDagPackNodes.ts';

export const DAG_FLOOR_WGSL = `fn extraBase()->u32{return liveCounter()+9u;}
fn pruneSlot(w:u32)->u32{return extraBase()+w;}
fn floorSlot(w:u32)->u32{return extraBase()+uni.worldCount+w;}
/** L'infini en f32 : aucun plancher fini ne lui est supérieur, donc rien n'est franchi tant que rien
 *  n'a été écarté. \`atomicMin\` sur les bits vaut \`min\` sur les flottants, tous positifs ici. */
const FLOOR_NONE:u32=0x7f800000u;
fn pruneCrossed(w:u32)->bool{return bitcast<f32>(atomicLoad(&work[w]))>bitcast<f32>(atomicLoad(&work[floorSlot(w)]));}
/** Miroir GPU de \`errorFloorAt\` (pageSelectionProjection.ts) : mêmes gardes, mêmes opérandes, même
 *  ordre. La plus petite erreur du sous-arbre vue à la profondeur la plus lointaine que sa sphère
 *  englobante autorise — jamais au-dessus de la valeur vraie d'une de ses grappes. Sans sphère,
 *  rayon négatif, il ne certifie rien et rend zéro. Preuve sur carte :
 *  \`bench/justesse/plancher-erreur-cpu-gpu.mjs\`. */
fn errorFloor(error:f32,depth:f32,radius:f32,stretch:f32,focal:f32)->f32{
 if(error==0.0){return 0.0;}
 if(!(error>0.0)||!(radius>=0.0)){return 0.0;}
 let far=depth+radius*stretch;
 if(!(far>0.0)){return INF;}
 return (error*stretch*focal)/far;
}
/** L'ouverture d'image de l'élagage : le seuil de l'image précédente devient celui auquel la
 *  descente élague, jamais sous celui de l'image, et le plancher écarté repart à \`FLOOR_NONE\`.
 *  \`work[w]\` porte encore le seuil final de l'image d'avant : l'appelant l'efface APRÈS, avec le
 *  seuil de l'image que ceci lui rend. */
fn resetPrune(w:u32)->f32{
 let seuil=max(uni.pixelError,0.0);
 let carried=bitcast<f32>(atomicLoad(&work[w]));
 atomicStore(&work[pruneSlot(w)],bitcast<u32>(select(seuil,carried,carried>seuil&&carried<INF)));
 atomicStore(&work[floorSlot(w)],FLOOR_NONE);
 return seuil;
}
/** Le verdict d'un nœud : son sous-arbre est-il trop grossier pour le seuil d'élagage de sa
 *  primitive ? Un sous-arbre qui porte une grappe que rien ne remplace ne l'est jamais. */
fn floorPrunes(w:u32,flags:u32,sphere:vec4f,error:f32,e:mat4x4f,stretch:f32,focal:f32)->bool{
 if((flags&${NODE_HAS_ROOT}u)!=0u){return false;}
 let low=errorFloor(error,-(e*vec4f(sphere.xyz,1.0)).z,sphere.w,stretch,focal);
 if(low<=bitcast<f32>(atomicLoad(&work[pruneSlot(w)]))){return false;}
 atomicMin(&work[floorSlot(w)],bitcast<u32>(low));
 return true;
}
`;
