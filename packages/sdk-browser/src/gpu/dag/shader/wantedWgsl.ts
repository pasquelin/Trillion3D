import { CLUSTER_LEVEL_SHIFT } from '../layout.ts';

/**
 * The three kernels that follow the descent, and that visit only what it kept.
 *
 * `dagWanted` walks the pages of the kept leaves: it drops those the frustum or the cone reject,
 * deposits the survivors in the live list (`liveWgsl.ts`), and publishes a REQUEST for each
 * one the cut keeps — the page and the priority the host will give it in its queue
 * (`../request.ts`).
 *
 * `dagEscalate` and `dagCheck` walk only that live list. They raise the primitive's threshold
 * toward the replacement's band while a cluster is missing, then record what is still missing:
 * that record is what arms the pinned fallback in `dagMask`.
 *
 * Kept apart from `shader.ts`, which holds the other kernels and the bind declarations:
 * these form one stage, they share their list, and the file that carried them all hit its line
 * limit.
 */
export const DAG_WANTED_WGSL = `@compute @workgroup_size(64)
fn dagWanted(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=min(atomicLoad(&work[candCounter()]),views[0u].clusterCount)){return;}
 // Only pages of the kept leaves: a page under a rejected node is never read, and its draw flag
 // is already zero — \`dagClearDrawn\` cleared the only ones that were one.
 let entry=flags[candBase()+s];let i=entryIndex(entry);vi=entryView(entry);
 let w=pageWorld(i);let r=recordOf(i,w);
 let cluster=clusters[r];
 if(!visible(r,w,cluster)){atomicAdd(&out.frustumRejected,1u);return;}
 liveAppend(entry);
 let rejected=(views[0u].viewFlags&VIEW_LIGHT)==0u&&coneRejects(r,w);
 flags[coneCache(i)]=select(0u,1u,rejected);
 let e=views[vi].view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,views[vi].pixelError)){return;}
 if(rejected){return;}
 atomicMax(&out.lodLevel,cluster.flags>>${CLUSTER_LEVEL_SHIFT}u);
 // The REPLACEMENT's error, what the eye would see if this cluster were missing: that is what
 // ranks the request, as \`orderPendingUrls\` (../../../streaming/priority.ts) does on the other path. A
 // cluster nothing replaces falls back on its own, as that path does.
 let parentPixels=projected(cluster.parentError,cluster.parentSphere,e,stretch,focal);
 var pixels=parentPixels;
 if(cluster.parentError<0.0){pixels=projected(cluster.lodError,cluster.sphere,e,stretch,focal);}
 emitOne(i,pixels);
 if(views[0u].residentCut==0u||isResident(i)){return;}
 // Escalation keeps the PARENT's band: on a cluster nothing replaces it is infinity, and that
 // is what arms the pinned fallback. Giving it the own error would strip that.
 escalate(slotOf(w),parentPixels);
}
@compute @workgroup_size(64)
fn dagEscalate(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=liveCount()||views[0u].residentCut==0u){return;}
 let entry=liveAt(s);let i=entryIndex(entry);vi=entryView(entry);
 if(isResident(i)){return;}
 let w=pageWorld(i);let cluster=clusters[recordOf(i,w)];
 let slot=slotOf(w);
 let e=views[vi].view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,bitcast<f32>(atomicLoad(&work[slot])))){return;}
 if(coneRejected(i)){return;}
 escalate(slot,projected(cluster.parentError,cluster.parentSphere,e,stretch,focal));
}
@compute @workgroup_size(64)
fn dagCheck(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=liveCount()||views[0u].residentCut==0u){return;}
 let entry=liveAt(s);let i=entryIndex(entry);vi=entryView(entry);
 if(isResident(i)){return;}
 let w=pageWorld(i);let cluster=clusters[recordOf(i,w)];
 let slot=slotOf(w);
 let e=views[vi].view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,bitcast<f32>(atomicLoad(&work[slot])))){return;}
 if(coneRejected(i)){return;}
 atomicOr(&work[slots()+slot],1u);
}
`;
