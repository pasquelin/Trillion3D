/**
 * La liste des grappes vivantes d'une image, et l'argument de répartition qui la dimensionne.
 *
 * Le tronc et les nœuds de coupe écartent déjà la très grande majorité des grappes : sur le banc à
 * douze instances, 1 581 313 des 1 959 792 grappes tombent par leur nœud ou par le tronc, et 378 479
 * survivent. Les cinq noyaux qui suivaient `dagWanted` — trois escalades, la vérification et le
 * masque — visitaient pourtant les 1 959 792, une par fil, et relisaient chacune son enregistrement
 * de grappe et son cône de page pour refaire le même rejet. C'est de la bande passante, pas du
 * calcul : ces passes lisent 112 octets par grappe et rien d'autre ne les retient.
 *
 * `dagWanted`, qui parcourt les candidates de la descente, dépose donc l'indice de chaque survivante
 * dans une liste, et les cinq noyaux se répartissent indirectement sur cette liste seule. Le verdict
 * de chacun est inchangé : ils commençaient tous par `visible`, et une grappe absente de la liste est
 * précisément une grappe dont `visible` était faux — donc une grappe dont ils ne faisaient rien.
 *
 * Le nombre de groupes de travail n'est plus tiré après coup par un noyau d'un seul fil : l'ajout qui
 * ouvre une tranche de soixante-quatre — celui dont le rang est un multiple de la taille de groupe —
 * incrémente le compte lui-même. Il vaut donc exactement `ceil(vivantes / 64)`, sans lancement de
 * plus et sans la latence fixe qu'un lancement d'un seul fil paie quand même.
 *
 * Le masque est la seule des cinq à écrire un drapeau de dessin ; celles qu'il ne visite pas valent
 * déjà zéro, `dagClearDrawn` ayant effacé les seules qui valaient un — celles de l'image d'avant.
 *
 * L'ordre d'écriture de la liste est celui d'un compteur atomique, donc indéterminé. Aucun des cinq
 * n'en dépend : trois accumulent par `atomicMax` et `atomicOr`, commutatifs, et le masque écrit à
 * l'indice de sa propre grappe. La liste compactée des pages dessinables, elle, est lue plus loin
 * dans l'ordre croissant des grappes, pas dans celui-ci.
 *
 * Aucun tampon de plus : le plafond de huit tampons de stockage par étape est déjà atteint. La liste
 * prolonge `flags` après le cache de cônes ; le compteur des vivantes et celui de leurs groupes
 * prolongent `work` après les blocs de la compaction, d'où l'argument de répartition est recopié —
 * WebGPU interdit le même tampon en écriture et en argument dans une même portée.
 */
export const DAG_LIVE_WGSL = `fn liveBase()->u32{return uni.nodeCount+uni.clusterCount*2u;}
fn liveCounter()->u32{return uni.worldCount*2u+blockCount()*2u;}
fn liveGroups()->u32{return liveCounter()+1u;}
fn liveCount()->u32{return atomicLoad(&work[liveCounter()]);}
fn liveAppend(i:u32){
 let s=atomicAdd(&work[liveCounter()],1u);
 flags[liveBase()+s]=i;
 if((s&63u)==0u){atomicAdd(&work[liveGroups()],1u);}
}
fn liveAt(s:u32)->u32{return flags[liveBase()+s];}
`;
