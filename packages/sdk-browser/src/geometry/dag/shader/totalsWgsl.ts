import { CLUSTER_TRANSPARENT } from '../clusterFlags.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { workgroupTallyWgsl } from '../../../gpu/core/workgroupTallyWgsl.ts'

/**
 * Triangle totals of a frame, held BY THE GPU.
 *
 * The CPU sums none: that would require it to know the cut — the whole list, reported frame after
 * frame. They are accumulated where the verdict is given, in `dagMask`, the only kernel that
 * knows what a frame draws.
 *
 * They are taken on the set the cut rule draws (`../../cut/rule.ts`): `selected`, the
 * triangles it draws — no cluster the rule draws can lack its bytes, so the readout copies it as
 * the drawn total (`../uniforms.ts`) —, and `transparent`, its blended share. A surface the rule
 * leaves undrawn has no cluster to count it, so no uncovered total is kept here: holes are proven
 * on the drawn set (`../../cut/cutRule.test.ts`, `held-gpu-cut.gpu.ts`).
 *
 * They describe the CUT, never the list that reports it: a rank the readback cap refuses does not
 * subtract from a total. That is what lets them survive the disappearance of the lists.
 *
 * THE SUM HAPPENS IN THE WORKGROUP FIRST. Unique words added by EVERY live cluster serialize the
 * whole GPU on a few addresses: that is the classic atomic hotspot, and it grows with the scene.
 * Each group of 64 threads therefore sums in its own shared memory, then two of its threads pour
 * the subtotal into the frame words (`workgroupTallyWgsl`, the engine's one such reduction): two
 * global adds per group instead of per cluster, for exactly the same numbers.
 */
const POUR = `if(lane==0u){atomicAdd(&out.selectedTriangles,n);}else{atomicAdd(&out.transparentTriangles,n);}`
export const DAG_TOTALS_WGSL = wgslBlock(
  'DAG_TOTALS_WGSL',
  [workgroupTallyWgsl('DAG_TALLY_WGSL', 2, 'true', POUR)],
  `fn tallyDrawn(r:u32,flags:u32,drawn:bool){
 if(!drawn){return;}
 let tri=trianglesOf(r);
 tallyAdd(0u,tri);
 if((flags&${CLUSTER_TRANSPARENT}u)!=0u){tallyAdd(1u,tri);}
}
fn resetTotaux(){
 atomicStore(&out.selectedTriangles,0u);atomicStore(&out.transparentTriangles,0u);
}
`,
)
