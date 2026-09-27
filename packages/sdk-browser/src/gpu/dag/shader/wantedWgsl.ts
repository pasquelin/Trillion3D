import { CLUSTER_LEVEL_SHIFT } from '../layout.ts';

/**
 * The kernel that follows the descent, and that visits only what it kept.
 *
 * `dagWanted` walks the pages of the kept leaves: it drops those the frustum or the cone reject,
 * deposits the survivors in the live list (`liveWgsl.ts`), and publishes a REQUEST for each
 * one the cut wants at the host's threshold — the page and the priority the host will give it in
 * its queue (`../request.ts`). A wanted cluster that is not resident is drawn through its nearest
 * resident ancestor (`dagMask`); a light view that does so says it drew coarser (`noteCoarser`).
 * A page the camera does not request goes to the view ahead (`aheadWgsl.ts`).
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
 // A page of the view ahead is only requested, never live; one the camera does not request is
 // tried there (\`aheadWgsl.ts\`).
 if(aheadOn()&&vi==AHEAD_VIEW){wantAhead(i,w,r,cluster);return;}
 if(!visible(r,w,cluster)){atomicAdd(&out.frustumRejected,1u);wantAhead(i,w,r,cluster);return;}
 liveAppend(entry);
 let light=(views[0u].viewFlags&VIEW_LIGHT)!=0u;
 let rejected=!light&&coneRejects(r,w);
 let e=viewWorld(w);let stretch=stretchOf(w);let focal=focalPixels();
 // The two screen errors \`selects\` compares, computed ONCE: the request's priority reuses them
 // (\`replacementPixels\` is one of the two), and a camera cut keeps the two comparisons of the cut
 // rule behind the cone bit, for \`dagMask\` — same operands, same frame, so the same bits.
 let parentPixels=projected(cluster.parentError,cluster.parentSphere,e,stretch,focal);
 let ownPixels=projected(cluster.lodError,cluster.sphere,e,stretch,focal);
 let t=views[vi].pixelError;
 // A light cut's views share the page index: its word stays the lone cone bit, zero, as before.
 flags[coneCache(i)]=select(select(0u,CONE_REJECTED,rejected)|select(0u,PARENT_ABOVE,parentPixels>t)|select(0u,OWN_WITHIN,ownPixels<=t),0u,light);
 if(!drawsCluster(true,parentPixels,ownPixels,true,t)||rejected){wantAhead(i,w,r,cluster);return;}
 atomicMax(&out.lodLevel,cluster.flags>>${CLUSTER_LEVEL_SHIFT}u);
 // \`replacementPixels\`: the replacement's error, or the cluster's own when nothing replaces it.
 emitOne(i,select(parentPixels,ownPixels,cluster.parentError<0.0));
 stampUse(i);
 if(views[0u].residentCut!=0u&&!isResident(i)){noteCoarser();}
}
/** The REPLACEMENT's error, what the eye would see if this cluster were missing: that is what
 *  ranks a request, as \`orderPendingUrls\` (../../../streaming/priority.ts) does on the other path.
 *  A cluster nothing replaces falls back on its own, as that path does. */
fn replacementPixels(cluster:Cluster,e:mat4x4f,stretch:f32,focal:f32)->f32{
 if(cluster.parentError<0.0){return projected(cluster.lodError,cluster.sphere,e,stretch,focal);}
 return projected(cluster.parentError,cluster.parentSphere,e,stretch,focal);
}
`;
