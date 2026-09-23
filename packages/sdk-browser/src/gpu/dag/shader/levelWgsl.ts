import { NODE_HAS_ROOT } from '../packNodes.ts';
/**
 * Level-by-level descent of the cut hierarchy, and the subtree pruning it allows.
 *
 * Previously one thread per node tested each node in isolation, then one thread per
 * cluster reread its cluster record to read, most of the time, only its leaf node's
 * flag. Clusters of a rejected node were therefore still visited: two million threads
 * and as many 112-byte reads per frame, to keep a fifth of them.
 *
 * The hierarchy already holds everything needed not to read them: `firstChild`,
 * `childCount`, an aggregated box and an aggregated `maxParentError`, both monotonic
 * — a node's box contains its children's, and its error ceiling upper-bounds theirs.
 * A node outside the trunk, or whose ceiling falls under the threshold, can therefore
 * carry no kept child and no kept cluster: that is the invariant CPU descent
 * (`../../../page/cut/visit.ts`) already exploits.
 *
 * Descent is therefore by levels: pass 0 starts from the roots — one per primitive,
 * set by `dagPrepare` —, each following pass only reads nodes the previous kept, and
 * only emits kept children. A kept leaf deposits its pages in the candidate list,
 * which `dagWanted` then dispatches over. The pass count is the hierarchy depth,
 * known at packing and small.
 *
 * A level pass is launched FLAT, not indirectly, and that is what prices descent.
 * Pass `L`'s queue only holds children of nodes kept at level `L-1`, hence only
 * nodes of level `L`, written compacted from zero: that level's node count, which
 * packing counts once and for all (`hierarchyLevelSizes`), upper-bounds it. Children
 * past the queue count leave on the guard, as they already did. That bound avoids
 * copying the dispatch argument's head word to an indirection buffer before each
 * pass, and nothing else: the whole descent fits in the head pass. What that is
 * worth is measured and written once, next to `hierarchyLevelSizes` (`../hierarchy.ts`).
 *
 * THREE queues in rotation, not two: the counter of the queue a level will fill must
 * be zero before it writes there, and with two queues that reset could only come from
 * the CPU, one more copy per level. With three queues, level `L` zeroes queue
 * `(L+2) % 3`: it does not read it — it reads `L % 3` — and does not write it — it
 * writes `(L+1) % 3` —, so none of its children can see it change, and the next pass
 * writes on a clean queue. Flat dispatch always opens at least one workgroup, so that
 * reset always happens.
 *
 * No new buffer for all that: the eight storage buffers per stage ceiling was hit
 * long ago. Queue 0 occupies the range node flags used, queues 1 and 2 follow the
 * candidates, and the counters extend `work` behind those of the live list. A queue
 * no longer has a group count: nobody reads it indirectly.
 *
 * The candidate list and the drawn log share a range: `dagClearDrawn` reads it as
 * a log at the very start of the frame, level passes then write it as candidates,
 * `dagWanted` rereads it, and `dagMask` only rewrites it as a log one pass later,
 * when nobody still reads the candidates.
 */
/** Descent queues, in rotation: level `L` reads `L % LEVEL_QUEUES`, writes `(L+1) % …`
 *  and zeroes `(L+2) % …`, which it neither reads nor writes. Three is the smallest
 *  count that makes those three indices distinct. */
export const LEVEL_QUEUES = 3;

export const DAG_LEVEL_WGSL = `fn queueBase(q:u32)->u32{return select(uni.nodeCount*q+uni.clusterCount*4u,0u,q==0u);}
fn candBase()->u32{return uni.nodeCount+uni.clusterCount*3u;}
fn queueCounter(q:u32)->u32{return liveCounter()+2u+q;}
fn candCounter()->u32{return liveCounter()+5u;}
fn candGroups()->u32{return candCounter()+1u;}
fn drawnCounter()->u32{return liveCounter()+7u;}
fn drawnGroups()->u32{return drawnCounter()+1u;}
/** Index of the primitive's root node, deposited once and for all behind its stretch. */
fn rootOf(w:u32)->u32{return bitcast<u32>(frames[w*FRAME+6u].y);}
/** A range append: the group count follows the opening of each sixty-four slice,
 *  so it equals \`ceil(total/64)\` without a one-thread kernel pulling it afterwards. */
fn spanAppend(counter:u32,groups:u32,base:u32,first:u32,count:u32){
 let at=atomicAdd(&work[counter],count);
 for(var k=0u;k<count;k++){
  flags[base+at+k]=first+k;
  if(((at+k)&63u)==0u){atomicAdd(&work[groups],1u);}
 }
}
/** The same append, without a group count: descent queues are read flat. */
fn queueAppend(dst:u32,first:u32,count:u32){
 let at=atomicAdd(&work[queueCounter(dst)],count);
 let base=queueBase(dst);
 for(var k=0u;k<count;k++){flags[base+at+k]=first+k;}
}
fn drawnAppend(page:u32){spanAppend(drawnCounter(),drawnGroups(),candBase(),page,1u);}
/** Frame counters, reset by a single thread. Queue 0 already counts its roots: one
 *  thread per primitive has just deposited its own, at its own rank, with no counter to contest. */
fn resetCounters(){
 atomicStore(&work[liveCounter()],0u);atomicStore(&work[liveGroups()],0u);
 atomicStore(&work[queueCounter(0u)],uni.worldCount);
 atomicStore(&work[queueCounter(1u)],0u);atomicStore(&work[queueCounter(2u)],0u);
 atomicStore(&work[candCounter()],0u);atomicStore(&work[candGroups()],0u);
 atomicStore(&work[drawnCounter()],0u);atomicStore(&work[drawnGroups()],0u);
}
/** Previous frame's drawn pages, zeroed by range: the only pages whose draw flag
 *  can be one. No other is visited, and none is walked in full. */
@compute @workgroup_size(64)
fn dagClearDrawn(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=atomicLoad(&work[drawnCounter()])){return;}
 flags[uni.nodeCount+flags[candBase()+s]]=0u;
}
/** A node of queue \`src\`: rejected, it yields nothing; kept, it deposits its children
 *  in the NEXT of the three queues, or its pages in the candidate list when it is a leaf. */
fn levelStep(src:u32,s:u32){
 // The queue the next level will fill resets to zero here: this level neither reads nor writes it.
 if(s==0u){atomicStore(&work[queueCounter((src+2u)%${LEVEL_QUEUES}u)],0u);}
 if(s>=atomicLoad(&work[queueCounter(src)])){return;}
 let i=flags[queueBase(src)+s];
 if(i==0xffffffffu){return;}
 let node=nodes[i];
 let w=node.worldIndex;
 if(outsideFrustum(w*FRAME,node.minimum,node.maximum)){atomicAdd(&out.frustumRejected,1u);return;}
 // Too FINE: no replacement of the subtree is coarse enough yet, the manifest carries it.
 // Too COARSE: no cluster of the subtree is fine enough, packing derives it from the pages.
 // A subtree that carries a cluster nothing replaces is exempt from the second — the pinned fallback
 // draws it without consulting a threshold, and descent is the only path by which it
 // reaches it. The trunk-reject count moves for neither: a subtree dropped here is
 // not dropped by the trunk, and the readout would say something other than what it names.
 //
 // A primitive whose manifest carries no ceiling and whose subtree is exempt reads
 // neither: the view·world, which only applies to them, is then not mounted.
 if(node.maxParentError>=0.0||(node.nodeFlags&${NODE_HAS_ROOT}u)==0u){
  let e=uni.view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
  if(node.maxParentError>=0.0&&projected(node.maxParentError,node.sphere,e,stretch,focal)<=uni.pixelError){atomicAdd(&out.frustumRejected,1u);return;}
  if(floorPrunes(w,node.nodeFlags,node.floorSphere,node.errorFloor,e,stretch,focal)){return;}
 }
 if(node.childCount>0u){queueAppend((src+1u)%${LEVEL_QUEUES}u,node.firstChild,node.childCount);return;}
 spanAppend(candCounter(),candGroups(),candBase(),node.firstPage,node.pageCount);
}
@compute @workgroup_size(64)
fn dagLevel0(@builtin(global_invocation_id) id:vec3u){levelStep(0u,id.x);}
@compute @workgroup_size(64)
fn dagLevel1(@builtin(global_invocation_id) id:vec3u){levelStep(1u,id.x);}
@compute @workgroup_size(64)
fn dagLevel2(@builtin(global_invocation_id) id:vec3u){levelStep(2u,id.x);}
`;
