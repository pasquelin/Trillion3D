import { EVICT_AGES, EVICT_LEVELS, KEY_PAGE_BITS } from '../evict.ts';

/**
 * `dagListEvictions`: the eviction queue, written into the frame's readback behind the drawn list
 * (`evictionWord`, `../layout.ts`) — a count, then the canonical pages in the order the cache gives
 * their slots back (`../evict.ts`, whose `listEvictions` is its mirror).
 *
 * One workgroup, as `dagSortRequests`, and the same counting sort without staging: a first sweep
 * counts each rank, `placeRanks` gives each rank its first place, a second sweep scatters. The
 * sweeps read the pool's bit set (`poolBase`, one word for thirty-two pages, set on each key's
 * canonical page alone), not a record per page: what they list is what the pool holds. The queue stops at the pool's slots (`poolSlots`, in
 * the uniforms), keeping the highest ranks.
 */
export const DAG_EVICT_WGSL = `const KEY_PAGE:u32=${(1 << KEY_PAGE_BITS) - 1}u;
/** Word \`k\` of the eviction queue in \`out.pages\`: 0 its count, \`HEAD+j\` its entry \`j\`. */
fn evictAt(k:u32)->u32{return 2u*views[0u].listCap+HEAD+k;}
fn evictionCap()->u32{return min(views[0u].poolSlots,views[0u].listCap);}
/** Rank of canonical page \`i\` in the queue, \`RANKS\` when this cut read it. Integer only, as
 *  \`evictionRank\`. */
fn evictRank(i:u32,now:u32)->u32{
 let key=cold[keyBase()+i];let used=flags[lastUseAt(i)];
 if(used==now){return RANKS;}
 let level=min(key>>${KEY_PAGE_BITS}u,${EVICT_LEVELS - 1}u);
 let age=min(32u-countLeadingZeros(now-used),${EVICT_AGES - 1}u);
 return ((${EVICT_LEVELS - 1}u-level)*${EVICT_AGES}u)|age;
}
/** One sweep of the pool's pages: counts each rank, or, \`scatter\`, writes each page at its place. */
fn sweepPool(lane:u32,now:u32,scatter:bool){
 for(var w=lane;w<residentWords();w+=SORT_LANES){
  var bits=cold[poolBase()+w];
  while(bits!=0u){
   let i=w*32u+firstTrailingBit(bits);bits&=bits-1u;
   let rank=evictRank(i,now);
   if(rank>=RANKS){continue;}
   let at=atomicAdd(&rankPlace[rank],1u);
   if(scatter&&at<evictionCap()){out.pages[evictAt(HEAD+at)]=i;}
  }
 }
}
@compute @workgroup_size(SORT_LANES)
fn dagListEvictions(@builtin(local_invocation_index) lane:u32){
 let now=atomicLoad(&work[frameWord()]);
 for(var r=lane;r<RANKS;r+=SORT_LANES){atomicStore(&rankPlace[r],0u);}
 workgroupBarrier();
 sweepPool(lane,now,false);
 workgroupBarrier();
 if(lane==0u){out.pages[evictAt(0u)]=min(placeRanks(),evictionCap());}
 workgroupBarrier();
 sweepPool(lane,now,true);
}
`;
