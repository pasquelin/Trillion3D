import { CLUSTER_LEVEL_SHIFT } from '../clusterFlags.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'

/**
 * The kernel that follows the descent, and that visits only what it kept: THE CLUSTER CULL.
 *
 * `dagWanted` walks the pages of the leaves the running pass kept and saw — every one of them asked
 * for already (`depositLeaf`, `levelWgsl.ts`): it drops those wholly behind the view's clip plane
 * (`clipPlaneWgsl.ts`) and those the frustum rejects, applies the cut
 * rule — the error the cluster replaces shows, its own does not, or the finer group is not resident
 * (`../../cut/rule.ts`), on the residency `../readiness.ts` derives —, and judges what it draws
 * under the pyramid (`occlusionWgsl.ts`): seen, the cluster is appended to the list of visible
 * clusters (`visibleWgsl.ts`, `drawCluster`), to the software raster's end of it or the hardware
 * raster's; hidden by the previous image's pyramid alone, it is held for the post pass
 * (`postPassWgsl.ts`). No world cluster whose cell does not draw its actor is among them: the
 * descent opens no node of such an actor (`worldNodeHides`). The post pass walks its own
 * candidates, behind the main pass's (`candFirst`).
 *
 * The triangles of what it draws are summed in the workgroup first (`totalsWgsl.ts`), so every
 * thread of the group crosses the barrier: a thread with no cluster does not return early, it
 * draws nothing.
 *
 * Kept apart from `shader.ts`, which holds the other kernels and the bind declarations.
 */
export const DAG_WANTED_WGSL = wgslBlock(
  'DAG_WANTED_WGSL',
  [FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL],
  `/** Candidate \`s\` judged: drawn, held for the post pass, or dropped. */
fn wantedStep(s:u32){
 let i=flagAt(candBase()+2u*s);let w=flagAt(candBase()+2u*s+1u);
 deformReach=reachOf(w);let r=recordOf(i,w);
 let cluster=clusterAt(r);
 if(outsideClipPlane(w,boxMin(r),boxMax(r))){return;}
 if(!clusterInView(r,w,cluster)){atomicAdd(&out.frustumRejected,1u);return;}
 let rule=clusterRule(cluster,viewWorld(w));
 if(rule.x&&rule.y){atomicMax(&out.lodLevel,cluster.flags>>${CLUSTER_LEVEL_SHIFT}u);}
 if(!drawsCompared(isResident(i),rule.x,rule.y,childResident(i))){return;}
 if(hasBox(r)!=0.0&&!unculledOf(w)){
  let sight=boxSight(boxMin(r),boxMax(r),w);
  if(sight==BOX_OCCLUDED){postCluster(i,w);}
  if(sight!=BOX_SEEN){return;}
 }
 drawCluster(i,w,r,cluster);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn dagWanted(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lid:u32){
 let s=candFirst()+flatIndex(id,n,WORKGROUP_THREADS);
 if(s<min(atomicLoad(&work[candCounter()]),cutView.candCap)){wantedStep(s);}
 flushTally(lid);
}
`,
)
