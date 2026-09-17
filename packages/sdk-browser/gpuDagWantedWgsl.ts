import { CLUSTER_LEVEL_SHIFT } from './gpuDagLayout.ts';

/**
 * Les trois noyaux qui suivent la descente, et qui ne visitent que ce qu'elle a retenu.
 *
 * `dagWanted` parcourt les pages des feuilles retenues : il écarte celles que le tronc ou le cône
 * rejettent, dépose les survivantes dans la liste des vivantes (`gpuDagLiveWgsl.ts`), et publie une
 * DEMANDE pour chacune de celles que la coupe retient — la page et la priorité que l'hôte lui
 * donnera dans sa file (`gpuDagRequest.ts`).
 *
 * `dagEscalate` et `dagCheck` ne parcourent que cette liste de vivantes. Ils montent le seuil de la
 * primitive vers la bande du remplaçant tant qu'une grappe manque, puis constatent ce qui manque
 * encore : c'est ce constat qui arme le repli épinglé dans `dagMask`.
 *
 * Posés à part de `gpuDagShader.ts`, qui tient les autres noyaux et la déclaration des liaisons :
 * ceux-ci forment une étape, ils partagent leur liste, et le fichier qui les portait tous a atteint
 * sa limite de lignes.
 */
export const DAG_WANTED_WGSL = `@compute @workgroup_size(64)
fn dagWanted(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=atomicLoad(&work[candCounter()])){return;}
 // Seules les pages des feuilles retenues : une page sous un nœud rejeté n'est jamais lue, et son
 // drapeau de dessin vaut déjà zéro — \`dagClearDrawn\` a effacé les seules qui valaient un.
 let i=flags[candBase()+s];
 let cluster=clusters[i];
 if(!visible(i,cluster)){atomicAdd(&out.frustumRejected,1u);return;}
 liveAppend(i);
 let rejected=coneRejects(i,cluster);
 flags[coneCache(i)]=select(0u,1u,rejected);
 let w=cluster.worldIndex;
 let e=uni.view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,uni.pixelError)){return;}
 if(rejected){return;}
 atomicMax(&out.lodLevel,cluster.flags>>${CLUSTER_LEVEL_SHIFT}u);
 // L'erreur du REMPLAÇANT, celle que l'œil verrait si cette grappe manquait : c'est elle qui donne
 // son rang à la demande, comme \`orderPendingUrls\` (streamingPriority.ts) le fait sur l'autre
 // chemin. Une grappe que rien ne remplace retombe sur la sienne, comme lui.
 let parentPixels=projected(cluster.parentError,cluster.parentSphere,e,stretch,focal);
 var pixels=parentPixels;
 if(cluster.parentError<0.0){pixels=projected(cluster.lodError,cluster.sphere,e,stretch,focal);}
 emitOne(i,pixels);
 if(uni.residentCut==0u||isResident(i)){return;}
 // L'escalade garde la bande du PARENT : sur une grappe que rien ne remplace elle vaut l'infini,
 // et c'est ce qui arme le repli épinglé. Lui donner l'erreur propre l'en priverait.
 escalate(w,parentPixels);
}
@compute @workgroup_size(64)
fn dagEscalate(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=liveCount()||uni.residentCut==0u){return;}
 let i=liveAt(s);
 if(isResident(i)){return;}
 let cluster=clusters[i];
 let w=cluster.worldIndex;
 let e=uni.view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,bitcast<f32>(atomicLoad(&work[w])))){return;}
 if(coneRejected(i)){return;}
 escalate(w,projected(cluster.parentError,cluster.parentSphere,e,stretch,focal));
}
@compute @workgroup_size(64)
fn dagCheck(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=liveCount()||uni.residentCut==0u){return;}
 let i=liveAt(s);
 if(isResident(i)){return;}
 let cluster=clusters[i];
 let w=cluster.worldIndex;
 let e=uni.view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,bitcast<f32>(atomicLoad(&work[w])))){return;}
 if(coneRejected(i)){return;}
 atomicOr(&work[uni.worldCount+w],1u);
}
`;
