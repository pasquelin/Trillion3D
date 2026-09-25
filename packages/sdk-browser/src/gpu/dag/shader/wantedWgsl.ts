import { CLUSTER_LEVEL_SHIFT } from '../layout.ts';

/**
 * The kernel that follows the descent, and that visits only what it kept.
 *
 * `dagWanted` walks the pages of the kept leaves: it drops those the frustum or the cone reject,
 * deposits the survivors in the live list (`liveWgsl.ts`), and publishes a REQUEST for each
 * one the cut wants at the host's threshold — the page and the priority the host will give it in
 * its queue (`../request.ts`). A wanted cluster that is not resident is drawn through its nearest
 * resident ancestor (`dagMask`); a light view that does so says it drew coarser (`noteCoarser`).
 *
 * Kept apart from `shader.ts`, which holds the other kernels and the bind declarations.
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
 var pixels=projected(cluster.parentError,cluster.parentSphere,e,stretch,focal);
 if(cluster.parentError<0.0){pixels=projected(cluster.lodError,cluster.sphere,e,stretch,focal);}
 emitOne(i,pixels);
 if(views[0u].residentCut!=0u&&!isResident(i)){noteCoarser();}
}
`;
