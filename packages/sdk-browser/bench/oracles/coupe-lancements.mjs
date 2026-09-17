/**
 * Le noyau de descente d'AVANT le lot « sélection persistante », recopié tel quel : deux files en
 * bascule, dont le compteur ne peut repartir de zéro que par une copie du processeur, une par
 * niveau. Il sert d'ORACLE au banc `coupe-lancements-gpu.mjs` : les deux textes tournent sur la
 * même scène dans le même Chromium, et le banc n'est recevable que s'ils retiennent les mêmes
 * pages, au bit près. Aucun module du moteur ne l'importe.
 *
 * Ses décalages dans `work` sont ceux d'avant : la liste des candidates au mot six derrière le
 * compteur des vivantes, le journal des dessinées au mot huit, et deux files seulement.
 */
export const DAG_LEVEL_WGSL_AVANT = `fn queueBase(q:u32)->u32{return select(0u,uni.nodeCount+uni.clusterCount*4u,q==1u);}
fn candBase()->u32{return uni.nodeCount+uni.clusterCount*3u;}
fn queueCounter(q:u32)->u32{return liveCounter()+2u+q*2u;}
fn queueGroups(q:u32)->u32{return queueCounter(q)+1u;}
fn candCounter()->u32{return liveCounter()+6u;}
fn candGroups()->u32{return candCounter()+1u;}
fn drawnCounter()->u32{return liveCounter()+8u;}
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
fn drawnAppend(page:u32){spanAppend(drawnCounter(),drawnGroups(),candBase(),page,1u);}
/** Les compteurs de l'image, remis à zéro par un seul fil. La file 0 compte déjà ses racines : un
 *  fil par primitive vient d'y déposer la sienne, à son propre rang, sans compteur à disputer. */
fn resetCounters(){
 atomicStore(&work[liveCounter()],0u);atomicStore(&work[liveGroups()],0u);
 atomicStore(&work[queueCounter(0u)],uni.worldCount);atomicStore(&work[queueGroups(0u)],(uni.worldCount+63u)/64u);
 atomicStore(&work[queueCounter(1u)],0u);atomicStore(&work[queueGroups(1u)],0u);
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
 *  file opposée, ou ses pages dans la liste des candidates quand c'est une feuille. */
fn levelStep(src:u32,s:u32){
 if(s>=atomicLoad(&work[queueCounter(src)])){return;}
 let i=flags[queueBase(src)+s];
 if(i==0xffffffffu){return;}
 let node=nodes[i];
 if(outsideFrustum(node.worldIndex*FRAME,node.minimum,node.maximum)){atomicAdd(&out.frustumRejected,1u);return;}
 if(node.maxParentError>=0.0){
  let e=uni.view*worlds[node.worldIndex];
  if(projected(node.maxParentError,node.sphere,e,stretchOf(node.worldIndex),focalPixels())<=uni.pixelError){atomicAdd(&out.frustumRejected,1u);return;}
 }
 if(node.childCount>0u){spanAppend(queueCounter(1u-src),queueGroups(1u-src),queueBase(1u-src),node.firstChild,node.childCount);return;}
 spanAppend(candCounter(),candGroups(),candBase(),node.firstPage,node.pageCount);
}
@compute @workgroup_size(64)
fn dagLevel0(@builtin(global_invocation_id) id:vec3u){levelStep(0u,id.x);}
@compute @workgroup_size(64)
fn dagLevel1(@builtin(global_invocation_id) id:vec3u){levelStep(1u,id.x);}
`;
