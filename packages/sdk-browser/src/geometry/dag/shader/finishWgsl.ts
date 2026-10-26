import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { ceilDivWgsl } from '../../../../../math/src/wgsl/integer.ts'
import { VISIBLE_LAYOUT_WGSL } from '../visible/layout.ts'
import {
  PEAK_CANDIDATES,
  PEAK_NODES,
  PEAK_VISIBLE,
  SELECTION_HEADER_WORDS,
} from '../readoutWords.ts'

/**
 * WHAT A CUT ENDS WITH, once its last pass wrote its clusters: two kernels, the readout's.
 *
 * `dagFinish`, one thread, writes into the drawn list's header (`PEAK_NODES`, `../readoutWords.ts`)
 * the most each list was asked — the nodes a pass opened, the candidate clusters of a pass, the visible
 * clusters of both passes, counted past their room, as asked —, which the readback's warning reads
 * (`../lists/listFeedback.ts`), the number of clusters drawn, and arms the dispatch of the next
 * kernel over the longer of the two lists of visible clusters (`visibleGroups`).
 *
 * `dagDrawn`, a thread a record of each list, copies the page of every visible cluster — the
 * software raster's, then the hardware raster's — into the drawn list of the readout, behind its
 * header: the pages the cut drew, in the order its threads wrote them, which the host sorts
 * (`../uniforms.ts`). No mask, no prefix and no scatter stand between the cut and the list: a
 * cluster's place in it is its place in the list of visible clusters.
 */
export const DAG_FINISH_WGSL = wgslBlock(
  'DAG_FINISH_WGSL',
  [FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL, ceilDivWgsl, VISIBLE_LAYOUT_WGSL],
  `const HEAD:u32=${SELECTION_HEADER_WORDS}u;
/** The software clusters the list holds, and the hardware ones: the counts held, kept to its room
 *  (the cut's appends take the room first, so the clamp is a guard for a reader of another list). */
fn heldSoftware()->u32{return min(atomicLoad(&visible[VIS_SW]),cutView.visCap);}
fn heldHardware()->u32{return min(atomicLoad(&visible[VIS_HW]),cutView.visCap-heldSoftware());}
@compute @workgroup_size(1)
fn dagFinish(){
 let peaks=cutView.listCap;
 out.pages[peaks+${PEAK_NODES}u]=max(atomicLoad(&work[nodeTotalWord(CUT_MAIN)]),atomicLoad(&work[nodeTotalWord(CUT_POST)]));
 let asked=atomicLoad(&work[clusterTotalWord()]);let mainAsked=atomicLoad(&work[mainClusterWord()]);
 out.pages[peaks+${PEAK_CANDIDATES}u]=max(mainAsked,asked-mainAsked);
 out.pages[peaks+${PEAK_VISIBLE}u]=atomicLoad(&visible[VIS_ASKED]);
 let drawn=heldSoftware()+heldHardware();
 out.pages[peaks]=drawn;
 if(drawn>peaks){atomicOr(&out.overflow,1u);}
 armGroups(visibleGroups(),ceilDiv(max(max(heldSoftware(),heldHardware()),1u),WORKGROUP_THREADS));
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn dagDrawn(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let t=flatIndex(id,n,WORKGROUP_THREADS);
 let software=heldSoftware();let hardware=heldHardware();
 if(t<software&&t<cutView.listCap){
  out.pages[cutView.listCap+HEAD+t]=atomicLoad(&visible[VISIBLE_HEADER_WORDS+VISIBLE_RECORD_WORDS*t]);
 }
 let at=software+t;
 if(t<hardware&&at<cutView.listCap){
  let v=cutView.visCap-1u-t;
  out.pages[cutView.listCap+HEAD+at]=atomicLoad(&visible[VISIBLE_HEADER_WORDS+VISIBLE_RECORD_WORDS*v]);
 }
}
`,
)
