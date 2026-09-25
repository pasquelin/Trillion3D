/**
 * The list of live clusters of a frame, and the dispatch argument that sizes it.
 *
 * The frustum and the cut nodes already drop the vast majority of clusters: on the
 * twelve-instance bench, 1,581,313 of the 1,959,792 clusters fall by their node or by the
 * frustum, and 378,479 survive. The kernels that followed `dagWanted` — the mask among them —
 * still visited all 1,959,792, one per thread, and reread each
 * cluster record and page cone to redo the same reject. That is bandwidth, not compute: those
 * passes read 112 bytes per cluster and nothing else holds them.
 *
 * `dagWanted`, which walks the descent's candidates, therefore deposits each survivor's index
 * in a list, and the kernels that follow dispatch indirectly over that list alone. Each verdict
 * is unchanged: they all started with `visible`, and a cluster absent from the list is precisely
 * a cluster whose `visible` was false — hence a cluster they did nothing with.
 *
 * The workgroup count is no longer pulled afterwards by a single-thread kernel: the append
 * that opens a sixty-four-wide slice — the one whose rank is a multiple of the group size —
 * increments the count itself. It is therefore exactly `ceil(live / 64)`, with no extra
 * dispatch and without the fixed latency a single-thread dispatch pays anyway.
 *
 * The mask is the only one of them to write a draw flag; those it does not visit are
 * already zero, `dagClearDrawn` having cleared the only ones that were one — those of the
 * previous frame.
 *
 * The list's write order is that of an atomic counter, hence indeterminate. None of them
 * depends on it: the mask writes at its own cluster's index and accumulates with commutative
 * atomics. The compacted drawable-page list is read further on in
 * increasing cluster order, not this one.
 *
 * No extra buffer: the eight storage buffers per stage ceiling is already reached. The list
 * extends `flags` after the cone cache; the live counter and their group counter extend
 * `work` after the compaction blocks, from which the dispatch argument is copied — WebGPU
 * forbids the same buffer as write and as argument in one scope.
 */
export const DAG_LIVE_WGSL = `fn liveBase()->u32{return views[0u].queueCap+views[0u].clusterCount*2u;}
fn liveCounter()->u32{return blockCount()*2u;}
fn liveGroups()->u32{return liveCounter()+1u;}
fn liveCount()->u32{return min(atomicLoad(&work[liveCounter()]),views[0u].clusterCount);}
/** \`entry\` is the candidate's, view included. A light cut also counts each view's live
 *  clusters: they bound the view's share of the drawn log (\`dagViewOffsets\`). */
fn liveAppend(entry:u32){
 let s=atomicAdd(&work[liveCounter()],1u);
 if(s>=views[0u].clusterCount){dropWork();return;}
 flags[liveBase()+s]=entry;
 if((s&63u)==0u){atomicAdd(&work[liveGroups()],1u);}
 if(isLightCut()){atomicAdd(&work[viewWord(0u,vi)],1u);}
}
fn liveAt(s:u32)->u32{return flags[liveBase()+s];}
`;
