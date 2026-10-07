import { CLUSTER_LEVEL_SHIFT } from '../clusterFlags.ts'

/**
 * The kernel that follows the descent, and that visits only what it kept.
 *
 * `dagWanted` walks the pages of the kept leaves: it drops those the frustum or the cone reject,
 * deposits the survivors in the live list (`liveWgsl.ts`), and publishes a REQUEST for each
 * one the cut wants at the host's threshold — the page and the priority the host will give it in
 * its queue (`../request.ts`). A wanted cluster that is not resident is drawn through its nearest
 * resident ancestor (`dagMask`).
 * A page the camera does not request goes to the view ahead (`aheadWgsl.ts`).
 *
 * Kept apart from `shader.ts`, which holds the other kernels and the bind declarations.
 */
export const DAG_WANTED_WGSL = `@compute @workgroup_size(64)
fn dagWanted(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let s=flatIndex(id,n,64u);if(s>=min(atomicLoad(&work[candCounter()]),views[0u].clusterCount)){return;}
 // Only pages of the kept leaves: a page under a rejected node is never read, and its draw flag
 // is already zero — \`dagClearDrawn\` cleared the only ones that were one.
 let entry=flagAt(candBase()+s);let i=entryIndex(entry);vi=entryView(entry);
 let w=pageWorld(i);if(!inRange(w)){return;}deformReach=reachOf(w);let r=recordOf(i,w);
 let cluster=clusterAt(r);
 // A page of the view ahead is only requested, never live; one the camera does not request is
 // tried there (\`aheadWgsl.ts\`).
 if(aheadOn()&&vi==AHEAD_VIEW){wantAhead(i,w,r,cluster);return;}
 if(!visible(r,w,cluster)){atomicAdd(&out.frustumRejected,1u);wantAhead(i,w,r,cluster);return;}
 liveAppend(entry);
 let rejected=coneRejects(r,w);
 let e=viewWorld(w);let stretch=stretchOf(w);let focal=focalPixels();
 // The two screen errors \`selects\` compares, computed ONCE: the request's priority reuses them
 // (\`replacementPixels\`), and a camera cut keeps the two comparisons of the cut rule behind the
 // cone bit, for \`dagMask\` — same operands, same frame, so the same bits.
 let pixels=clusterPixels(cluster,e,stretch,focal);let t=views[vi].pixelError;
 setFlag(coneCache(i),select(0u,CONE_REJECTED,rejected)|select(0u,PARENT_ABOVE,pixels.x>t)|select(0u,OWN_WITHIN,pixels.y<=t));
 if(!selects(pixels,t)||rejected){wantAhead(i,w,r,cluster);return;}
 atomicMax(&out.lodLevel,cluster.flags>>${CLUSTER_LEVEL_SHIFT}u);
 emitOne(i,cameraPriority(cluster.flags,replacementPixels(cluster,pixels)));
 stampUse(i);
}
/** The REPLACEMENT's error, what the eye would see if this cluster were missing: that is what
 *  ranks a request, as \`orderPendingUrls\` (../../../streaming/priority.ts) does on the other path.
 *  A cluster nothing replaces falls back on its own, as that path does. */
fn replacementPixels(cluster:Cluster,pixels:vec2f)->f32{return select(pixels.x,pixels.y,cluster.parentError<0.0);}
`
