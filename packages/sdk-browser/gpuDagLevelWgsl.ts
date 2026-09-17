/**
 * La descente par niveaux de la hiérarchie de coupe, et l'élagage de sous-arbre qu'elle permet.
 *
 * Hier un fil par nœud testait chaque nœud isolément, puis un fil par grappe relisait
 * l'enregistrement de sa grappe pour n'y lire, la plupart du temps, que le drapeau de son nœud
 * feuille. Les grappes d'un nœud rejeté étaient donc quand même visitées : deux millions de fils et
 * autant de lectures de 112 octets par image, pour en retenir un cinquième.
 *
 * La hiérarchie porte déjà tout ce qu'il faut pour ne pas les lire : `firstChild`, `childCount`,
 * une boîte agrégée et un `maxParentError` agrégé, tous deux monotones — la boîte d'un nœud contient
 * celles de ses enfants, et son plafond d'erreur majore les leurs. Un nœud hors du tronc, ou dont le
 * plafond passe sous le seuil, ne peut donc porter aucun enfant retenu ni aucune grappe retenue :
 * c'est l'invariant que la descente processeur (`pageSelectionCutVisit.ts`) exploite déjà.
 *
 * La descente se fait donc par niveaux : la passe 0 part des racines — une par primitive, posée par
 * `dagPrepare` —, chaque passe suivante ne lit que les nœuds que la précédente a retenus, et n'émet
 * que les enfants retenus. Une feuille retenue dépose ses pages dans la liste des candidates, sur
 * laquelle `dagWanted` se répartit à son tour. Le nombre de passes vaut la profondeur de la
 * hiérarchie, connue au rangement et petite.
 *
 * Une passe de niveau est lancée À PLAT, non indirectement, et c'est ce qui fait le prix de la
 * descente. La file de la passe `L` ne porte que des enfants de nœuds retenus à l'étage `L-1`, donc
 * que des nœuds de l'étage `L`, écrits compactés à partir de zéro : le nombre de nœuds de cet étage,
 * que le rangement compte une fois pour toutes (`hierarchyLevelSizes`), la majore. Les fils au-delà
 * du compte de la file sortent sur la garde, comme ils le faisaient déjà. Ce majorant évite de
 * recopier le mot de tête de l'argument de répartition vers un tampon d'indirection avant chaque
 * passe, ni rien d'autre : toute la descente tient dans la passe de tête. Ce que cela vaut est
 * mesuré et écrit une seule fois, auprès de `hierarchyLevelSizes` (`gpuDagHierarchy.ts`).
 *
 * TROIS files en rotation, pas deux : le compteur de la file qu'un niveau va remplir doit valoir zéro
 * avant qu'il n'y écrive, et avec deux files cette remise à zéro ne pouvait venir que du processeur,
 * par une copie de plus par niveau. Avec trois files, le niveau `L` remet à zéro la file `(L+2) % 3` :
 * il ne la lit pas — il lit `L % 3` — et ne l'écrit pas — il écrit `(L+1) % 3` —, donc aucun de ses
 * fils ne peut la voir changer, et la passe suivante l'écrit sur une file propre. Le lancement à plat
 * ouvre toujours au moins un groupe de travail, si bien que cette remise à zéro a toujours lieu.
 *
 * Pas de tampon neuf pour autant : le plafond de huit tampons de stockage par étape est atteint
 * depuis longtemps. La file 0 occupe la plage que les drapeaux de nœuds occupaient, les files 1 et 2
 * suivent les candidates, et les compteurs prolongent `work` derrière ceux de la liste vivante. Une
 * file n'a plus de compte de groupes : plus personne ne la lit indirectement.
 *
 * La liste des candidates et le journal des dessinées partagent une plage : `dagClearDrawn` la lit
 * comme journal au tout début de l'image, les passes de niveau l'écrivent ensuite comme candidates,
 * `dagWanted` la relit, et `dagMask` ne la réécrit comme journal qu'une passe plus tard, quand plus
 * personne n'en lit les candidates.
 */
/** Les files de la descente, en rotation : le niveau `L` lit `L % LEVEL_QUEUES`, écrit `(L+1) % …`
 *  et remet à zéro `(L+2) % …`, qu'il ne touche ni en lecture ni en écriture. Trois est le plus petit
 *  compte qui rende ces trois indices distincts. */
export const LEVEL_QUEUES = 3;

export const DAG_LEVEL_WGSL = `fn queueBase(q:u32)->u32{return select(uni.nodeCount*q+uni.clusterCount*4u,0u,q==0u);}
fn candBase()->u32{return uni.nodeCount+uni.clusterCount*3u;}
fn queueCounter(q:u32)->u32{return liveCounter()+2u+q;}
fn candCounter()->u32{return liveCounter()+5u;}
fn candGroups()->u32{return candCounter()+1u;}
fn drawnCounter()->u32{return liveCounter()+7u;}
fn drawnGroups()->u32{return drawnCounter()+1u;}
/** L'indice du nœud racine de la primitive, déposé une fois pour toutes derrière son étirement. */
fn rootOf(w:u32)->u32{return bitcast<u32>(frames[w*FRAME+6u].y);}
/** Un ajout de plage : le compte de groupes suit l'ouverture de chaque tranche de soixante-quatre,
 *  donc vaut exactement \`ceil(total/64)\` sans qu'un noyau d'un seul fil le tire après coup. */
fn spanAppend(counter:u32,groups:u32,base:u32,first:u32,count:u32){
 let at=atomicAdd(&work[counter],count);
 for(var k=0u;k<count;k++){
  flags[base+at+k]=first+k;
  if(((at+k)&63u)==0u){atomicAdd(&work[groups],1u);}
 }
}
/** Le même ajout, sans compte de groupes : les files de la descente sont lues à plat. */
fn queueAppend(dst:u32,first:u32,count:u32){
 let at=atomicAdd(&work[queueCounter(dst)],count);
 let base=queueBase(dst);
 for(var k=0u;k<count;k++){flags[base+at+k]=first+k;}
}
fn drawnAppend(page:u32){spanAppend(drawnCounter(),drawnGroups(),candBase(),page,1u);}
/** Les compteurs de l'image, remis à zéro par un seul fil. La file 0 compte déjà ses racines : un
 *  fil par primitive vient d'y déposer la sienne, à son propre rang, sans compteur à disputer. */
fn resetCounters(){
 atomicStore(&work[liveCounter()],0u);atomicStore(&work[liveGroups()],0u);
 atomicStore(&work[queueCounter(0u)],uni.worldCount);
 atomicStore(&work[queueCounter(1u)],0u);atomicStore(&work[queueCounter(2u)],0u);
 atomicStore(&work[candCounter()],0u);atomicStore(&work[candGroups()],0u);
 atomicStore(&work[drawnCounter()],0u);atomicStore(&work[drawnGroups()],0u);
}
/** Les dessinées de l'image précédente, remises à zéro par plage : les seules pages dont le drapeau
 *  de dessin puisse valoir un. Aucune autre n'est visitée, et aucune n'est parcourue en entier. */
@compute @workgroup_size(64)
fn dagClearDrawn(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=atomicLoad(&work[drawnCounter()])){return;}
 flags[uni.nodeCount+flags[candBase()+s]]=0u;
}
/** Un nœud de la file \`src\` : rejeté, il n'engendre rien ; retenu, il dépose ses enfants dans la
 *  file SUIVANTE des trois, ou ses pages dans la liste des candidates quand c'est une feuille. */
fn levelStep(src:u32,s:u32){
 // La file que le niveau suivant remplira repart de zéro ici : ce niveau ne la lit ni ne l'écrit.
 if(s==0u){atomicStore(&work[queueCounter((src+2u)%${LEVEL_QUEUES}u)],0u);}
 if(s>=atomicLoad(&work[queueCounter(src)])){return;}
 let i=flags[queueBase(src)+s];
 if(i==0xffffffffu){return;}
 let node=nodes[i];
 if(outsideFrustum(node.worldIndex*FRAME,node.minimum,node.maximum)){atomicAdd(&out.frustumRejected,1u);return;}
 if(node.maxParentError>=0.0){
  let e=uni.view*worlds[node.worldIndex];
  if(projected(node.maxParentError,node.sphere,e,stretchOf(node.worldIndex),focalPixels())<=uni.pixelError){atomicAdd(&out.frustumRejected,1u);return;}
 }
 if(node.childCount>0u){queueAppend((src+1u)%${LEVEL_QUEUES}u,node.firstChild,node.childCount);return;}
 spanAppend(candCounter(),candGroups(),candBase(),node.firstPage,node.pageCount);
}
@compute @workgroup_size(64)
fn dagLevel0(@builtin(global_invocation_id) id:vec3u){levelStep(0u,id.x);}
@compute @workgroup_size(64)
fn dagLevel1(@builtin(global_invocation_id) id:vec3u){levelStep(1u,id.x);}
@compute @workgroup_size(64)
fn dagLevel2(@builtin(global_invocation_id) id:vec3u){levelStep(2u,id.x);}
`;
