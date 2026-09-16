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
 * `dagWanted`, qui les parcourt toutes de toute façon, dépose donc l'indice de chaque survivante
 * dans une liste, et `dagArgs` en tire le nombre de groupes de travail. Les cinq noyaux se
 * répartissent alors indirectement sur cette liste seule. Le verdict de chacun est inchangé : ils
 * commençaient tous par `visible`, et une grappe absente de la liste est précisément une grappe dont
 * `visible` était faux — donc une grappe dont ils ne faisaient rien.
 *
 * Le masque est la seule des cinq à écrire pour toutes : `dagWanted` remet son drapeau de dessin à
 * zéro au passage, ce que le masque faisait pour les rejetées.
 *
 * L'ordre d'écriture de la liste est celui d'un compteur atomique, donc indéterminé. Aucun des cinq
 * n'en dépend : trois accumulent par `atomicMax` et `atomicOr`, commutatifs, et le masque écrit à
 * l'indice de sa propre grappe. La liste compactée des pages dessinables, elle, est lue plus loin
 * dans l'ordre croissant des grappes, pas dans celui-ci.
 *
 * Aucun tampon de plus : le plafond de huit tampons de stockage par étape est déjà atteint. La liste
 * prolonge `flags` après le cache de cônes, l'argument de répartition la suit — `flags` prend donc
 * l'usage `INDIRECT` —, et le compteur prolonge `work` après les blocs de la compaction.
 */
export const DAG_LIVE_WGSL = `fn liveBase()->u32{return uni.nodeCount+uni.clusterCount*2u;}
fn liveArgsBase()->u32{return liveBase()+uni.clusterCount;}
fn liveCounter()->u32{return uni.worldCount*2u+blockCount()*2u;}
fn liveCount()->u32{return atomicLoad(&work[liveCounter()]);}
fn liveAppend(i:u32){flags[liveBase()+atomicAdd(&work[liveCounter()],1u)]=i;}
fn liveAt(s:u32)->u32{return flags[liveBase()+s];}
@compute @workgroup_size(1)
fn dagArgs(){
 let base=liveArgsBase();
 flags[base]=(liveCount()+63u)/64u;flags[base+1u]=1u;flags[base+2u]=1u;
}
`;
