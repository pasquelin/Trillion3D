import { CLUSTER_TRANSPARENT } from './gpuDagLayout.ts';

/**
 * Les totaux de triangles d'une image, tenus PAR LA CARTE.
 *
 * Le processeur les sommait en parcourant la différence de coupe (`webgpuCutCounts.ts`) : ce qui
 * entre s'ajoute, ce qui sort se retire. Cela exigeait qu'il connaisse la coupe — la liste entière,
 * rapportée image après image. Ici ils sont accumulés là où le verdict est prononcé, dans `dagMask`,
 * le seul noyau qui sache ce qu'une image dessine.
 *
 * LES TROIS SONT PRIS SUR LE MÊME ENSEMBLE, et c'est ce qui tient l'invariant que le processeur
 * documentait — `selected − drawn − uncovered = 0` :
 *
 * - `voulu` : la COUPE DESSINABLE ENTIÈRE, c'est-à-dire ce que `dagMask` dessinerait si la résidence
 *   ne s'y opposait pas. Ce n'est pas ce que `dagWanted` retient : entre les deux, l'escalade de
 *   résidence a monté le seuil de la primitive, et une grappe retenue au seuil de l'image peut ne
 *   plus l'être au seuil escaladé.
 * - `dessinee` : ce qui part vraiment au raster, donc ce que le masque porte.
 * - `trou` : ce que la coupe voulait dessiner et que la résidence lui refuse. Exactement la
 *   différence des deux, jamais autre chose.
 *
 * Ils décrivent la COUPE, jamais la liste qui la rapporte : un rang que le plafond du relevé refuse
 * ne retire rien d'un total. C'est ce qui leur permet de survivre à la disparition des listes.
 *
 * LA SOMME SE FAIT D'ABORD DANS LE GROUPE. Quatre mots uniques additionnés par CHAQUE grappe vivante
 * sérialisent toute la carte sur quatre adresses : c'est le point chaud d'atomique classique, et il
 * grandit avec la scène. Chaque groupe de 64 fils somme donc dans sa propre mémoire partagée — une
 * atomique de groupe, sans trafic mémoire —, puis quatre de ses fils versent le sous-total dans les
 * mots d'image. La carte passe de quatre additions globales par grappe à quatre par groupe, soit
 * soixante-quatre fois moins de disputes, pour exactement les mêmes nombres.
 */
export const DAG_TOTALS_WGSL = `var<workgroup> totauxGroupe:array<atomic<u32>,4>;
fn ouvreTotaux(lid:u32){
 if(lid<4u){atomicStore(&totauxGroupe[lid],0u);}
 workgroupBarrier();
}
fn noteImage(i:u32,flags:u32,voulu:bool,dessinee:bool,trou:bool){
 if(!voulu){return;}
 let tri=trianglesOf(i);
 atomicAdd(&totauxGroupe[0],tri);
 if((flags&${CLUSTER_TRANSPARENT}u)!=0u){atomicAdd(&totauxGroupe[1],tri);}
 if(dessinee){atomicAdd(&totauxGroupe[2],tri);}
 if(trou){atomicAdd(&totauxGroupe[3],tri);}
}
/** Quatre fils, un compteur chacun : le groupe ne verse rien quand il n'a rien compté. La barrière
 *  est franchie par TOUS les fils du groupe, y compris ceux qui n'avaient pas de grappe. */
fn verseTotaux(lid:u32){
 workgroupBarrier();
 if(lid>=4u){return;}
 let v=atomicLoad(&totauxGroupe[lid]);
 if(v==0u){return;}
 switch lid{
  case 0u:{atomicAdd(&out.selectedTriangles,v);}
  case 1u:{atomicAdd(&out.transparentTriangles,v);}
  case 2u:{atomicAdd(&out.drawnTriangles,v);}
  default:{atomicAdd(&out.uncoveredTriangles,v);}
 }
}
fn resetTotaux(){
 atomicStore(&out.selectedTriangles,0u);atomicStore(&out.transparentTriangles,0u);
 atomicStore(&out.drawnTriangles,0u);atomicStore(&out.uncoveredTriangles,0u);
}
`;
