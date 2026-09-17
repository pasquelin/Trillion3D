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
 */
export const DAG_TOTALS_WGSL = `fn noteImage(i:u32,flags:u32,voulu:bool,dessinee:bool,trou:bool){
 if(!voulu){return;}
 let tri=trianglesOf(i);
 atomicAdd(&out.selectedTriangles,tri);
 if((flags&${CLUSTER_TRANSPARENT}u)!=0u){atomicAdd(&out.transparentTriangles,tri);}
 if(dessinee){atomicAdd(&out.drawnTriangles,tri);}
 if(trou){atomicAdd(&out.uncoveredTriangles,tri);}
}
fn resetTotaux(){
 atomicStore(&out.selectedTriangles,0u);atomicStore(&out.transparentTriangles,0u);
 atomicStore(&out.drawnTriangles,0u);atomicStore(&out.uncoveredTriangles,0u);
}
`;
