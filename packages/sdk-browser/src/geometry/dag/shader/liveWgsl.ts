import { WORK_BLOCK_WORDS } from './floorWgsl.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

/**
 * The list of live clusters of a frame — the clusters the cut draws —, and the dispatch argument
 * that sizes it.
 *
 * The frustum and the cut nodes already drop the vast majority of clusters: on the
 * twelve-instance bench, 1,581,313 of the 1,959,792 clusters fall by their node or by the
 * frustum, and 378,479 survive. The kernels that followed `dagWanted` — the mask among them —
 * still visited all 1,959,792, one per thread, and reread each cluster record to redo the same
 * reject. That is bandwidth, not compute: those passes read 112 bytes per cluster and nothing
 * else holds them.
 *
 * `dagWanted`, which walks the descent's candidates, therefore deposits each cluster it draws — the
 * cut rule's, past the pyramids (`occlusionWgsl.ts`) — in a list, with its placement, and the
 * kernels that follow dispatch indirectly over that list alone; the post pass deposits its own
 * behind the main pass's (`liveFirst`, `postPassWgsl.ts`).
 *
 * The workgroup count is not pulled afterwards by a single-thread kernel: the append
 * that opens a `WORKGROUP_THREADS`-wide slice — the one whose rank is a multiple of the group size —
 * raises the count itself (`openSlice`). It is therefore exactly
 * `ceil(live / WORKGROUP_THREADS)`, with no extra dispatch and without the fixed latency a single-thread
 * dispatch pays anyway.
 *
 * The mask is the only one of them to write a draw flag; the mask the cut writes starts each
 * main pass cleared (`dagPrepare`).
 *
 * The list's write order is that of an atomic counter, hence indeterminate. None of them
 * depends on it: the mask writes at its own cluster's index and accumulates with commutative
 * atomics. The compacted drawable-page list is read further on in
 * increasing cluster order, not this one.
 *
 * The list extends `flags` after the candidates; the live counter and its group counter extend
 * `work` after the compaction blocks, from which the arming kernel copies the dispatch argument —
 * WebGPU forbids, in one dispatch, an argument bound writable by a group its pipeline uses
 * (`armWgsl.ts`).
 */
export const DAG_LIVE_WGSL = wgslBlock(
  'DAG_LIVE_WGSL',
  [],
  `/** The live list behind the candidates, two words an entry: the page, its placement, \`visCap\` of
 *  them (\`cutMaxVisibleClusters\`), both passes'. */
fn liveBase()->u32{return views[0u].queueCap+2u*views[0u].candCap;}
fn liveCounter()->u32{return blockCount()*${WORK_BLOCK_WORDS}u;}
/** The live list's dispatch argument, x then y. */
fn liveGroups()->u32{return liveCounter()+1u;}
fn liveCount()->u32{return min(atomicLoad(&work[liveCounter()]),views[0u].visCap);}
/** Page \`page\` of placement \`w\` drawn by the running pass: past the cap, not drawn, its counter
 *  counting it still (the peak the readback brings back, \`dagCommitMask\`). */
fn liveAppend(page:u32,w:u32){
 listAppend(liveCounter(),liveGroups(),liveBase(),2u,views[0u].visCap,liveFirst(),page,1u,w);
}
fn liveAt(s:u32)->u32{return flagAt(liveBase()+2u*s);}
fn liveWorld(s:u32)->u32{return flagAt(liveBase()+2u*s+1u);}
`,
)
