// WGSL body of the descent kernel from BEFORE the "persistent selection" batch, split out of
// `coupe-lancements.ts` to keep it under the file line budget. See that file for the oracle's
// buffers and encoding, which read this string as the pipeline's shader module.
export const DAG_LEVEL_WGSL_AVANT = `fn queueBase(q:u32)->u32{return select(0u,uni.nodeCount+uni.clusterCount*4u,q==1u);}
fn candBase()->u32{return uni.nodeCount+uni.clusterCount*3u;}
fn queueCounter(q:u32)->u32{return liveCounter()+2u+q*2u;}
fn queueGroups(q:u32)->u32{return queueCounter(q)+1u;}
fn candCounter()->u32{return liveCounter()+6u;}
fn candGroups()->u32{return candCounter()+1u;}
fn drawnCounter()->u32{return liveCounter()+8u;}
fn drawnGroups()->u32{return drawnCounter()+1u;}
/** Index of the primitive's root node, deposited once and for all behind its stretch. */
fn rootOf(w:u32)->u32{return bitcast<u32>(frames[w*FRAME+6u].y);}
/** A range append: the group count follows the opening of each sixty-four slice,
 *  so it is exactly \`ceil(total/64)\` without a single-thread kernel pulling it afterwards. */
fn spanAppend(counter:u32,groups:u32,base:u32,first:u32,count:u32){
 let at=atomicAdd(&work[counter],count);
 for(var k=0u;k<count;k++){
  flags[base+at+k]=first+k;
  if(((at+k)&63u)==0u){atomicAdd(&work[groups],1u);}
 }
}
fn drawnAppend(page:u32){spanAppend(drawnCounter(),drawnGroups(),candBase(),page,1u);}
/** Frame counters, reset by a single thread. Queue 0 already counts its roots: one
 *  thread per primitive has just deposited its own, at its own rank, with no counter to dispute. */
fn resetCounters(){
 atomicStore(&work[liveCounter()],0u);atomicStore(&work[liveGroups()],0u);
 atomicStore(&work[queueCounter(0u)],uni.worldCount);atomicStore(&work[queueGroups(0u)],(uni.worldCount+63u)/64u);
 atomicStore(&work[queueCounter(1u)],0u);atomicStore(&work[queueGroups(1u)],0u);
 atomicStore(&work[candCounter()],0u);atomicStore(&work[candGroups()],0u);
 atomicStore(&work[drawnCounter()],0u);atomicStore(&work[drawnGroups()],0u);
}
/** Drawn pages of the previous frame, reset by range: the only pages whose draw flag
 *  can be one. No other is visited, and none is walked in full. */
@compute @workgroup_size(64)
fn dagClearDrawn(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=atomicLoad(&work[drawnCounter()])){return;}
 flags[uni.nodeCount+flags[candBase()+s]]=0u;
}
/** A node of queue \`src\`: rejected, it yields nothing; kept, it deposits its children in the
 *  opposite queue, or its pages in the candidate list when it is a leaf. */
fn levelStep(src:u32,s:u32){
 if(s>=atomicLoad(&work[queueCounter(src)])){return;}
 let i=flags[queueBase(src)+s];
 if(i==0xffffffffu){return;}
 let node=nodes[i];
 if(outsideFrustum(node.worldIndex*FRAME,node.minimum,node.maximum)){atomicAdd(&out.frustumRejected,1u);return;}
 if(node.maxParentError>=0.0){
  let e=uni.view*worlds[node.worldIndex];
  if(projected(node.maxParentError,node.sphere,e,stretchOf(node.worldIndex),focalPixels())<=uni.pixelError){atomicAdd(&out.frustumRejected,1u);return;}
 }
 if(node.childCount>0u){spanAppend(queueCounter(1u-src),queueGroups(1u-src),queueBase(1u-src),node.firstChild,node.childCount);return;}
 spanAppend(candCounter(),candGroups(),candBase(),node.firstPage,node.pageCount);
}
@compute @workgroup_size(64)
fn dagLevel0(@builtin(global_invocation_id) id:vec3u){levelStep(0u,id.x);}
@compute @workgroup_size(64)
fn dagLevel1(@builtin(global_invocation_id) id:vec3u){levelStep(1u,id.x);}
`;
