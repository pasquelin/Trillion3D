import { EVICT_AGES, EVICT_IN_USE, EVICT_LEVELS, KEY_PAGE_BITS, OLD_STEP } from '../evict.ts'
import { EVICTION_BURST } from '../layout.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { bitLength } from '../../../../../math/src/wgsl/integer.ts'

/**
 * `dagListEvictions`: the eviction queue behind the drawn list (`evictionWord`, `../layout.ts`), a
 * count, the count of its OLD head, then canonical pages (`../evict.ts`, `listEvictions` its
 * mirror). One workgroup, the counting sort of `dagSortRequests` without staging: a sweep of the
 * pool's list — its content keys — counts each rank, `placeRanks` places them, a second sweep
 * scatters the highest ranks, each as its key's canonical page, at most `EVICTION_BURST`. Every
 * key's group is raised to the frame's uses first, the groups replacing it with it (`raiseParents`).
 */
export const DAG_EVICT_WGSL = wgslBlock(
  'DAG_EVICT_WGSL',
  [bitLength],
  `const KEY_PAGE:u32=${(1 << KEY_PAGE_BITS) - 1}u;
/** Word \`k\` of the eviction queue in \`out.pages\`: 0 its count, 1 its old head's, \`HEAD+j\` its
 *  entry \`j\`. */
fn evictAt(k:u32)->u32{return 2u*views[0u].listCap+HEAD+k;}
/** Rank of content key \`k\` in the queue, \`RANKS\` while a view uses it: older age step first,
 *  then finer level. Integer only, as \`evictionRank\`. */
fn evictRank(k:u32,now:u32)->u32{
 let age=now-atomicLoad(&work[lastUseAt(groupOfKey(k))]);
 if(age<${EVICT_IN_USE}u){return RANKS;}
 let level=keyWordOf(k)>>${KEY_PAGE_BITS}u;
 return min(bitLength(age),${EVICT_AGES - 1}u)*${EVICT_LEVELS}u+(${EVICT_LEVELS - 1}u-level);
}
/** One sweep of the pool's list, one entry per held slot (\`../poolList.ts\`): counts each rank,
 *  or, \`scatter\`, writes each page at its place. */
fn sweepPool(lane:u32,now:u32,scatter:bool){
 let base=poolBase();let n=coldAt(base);
 for(var j=lane;j<n;j+=SORT_LANES){
  let k=coldAt(base+1u+j);let rank=evictRank(k,now);
  if(rank>=RANKS||(scatter&&atomicLoad(&rankPlace[rank])>=${EVICTION_BURST}u)){continue;}
  let at=atomicAdd(&rankPlace[rank],1u);
  if(scatter&&at<${EVICTION_BURST}u){out.pages[evictAt(HEAD+at)]=keyWordOf(k)&KEY_PAGE;}
 }
}
@compute @workgroup_size(SORT_LANES)
fn dagListEvictions(@builtin(local_invocation_index) lane:u32){
 let now=useClock();
 raiseParents(lane);
 for(var r=lane;r<RANKS;r+=SORT_LANES){atomicStore(&rankPlace[r],0u);}
 workgroupBarrier();
 sweepPool(lane,now,false);
 workgroupBarrier();
 // The old head: every key above the first rank of the view ahead's age step, placed first.
 if(lane==0u){
  out.pages[evictAt(0u)]=min(placeRanks(),${EVICTION_BURST}u);
  out.pages[evictAt(1u)]=min(atomicLoad(&rankPlace[${OLD_STEP * EVICT_LEVELS - 1}u]),${EVICTION_BURST}u);
 }
 workgroupBarrier();
 sweepPool(lane,now,true);
}
`,
)
