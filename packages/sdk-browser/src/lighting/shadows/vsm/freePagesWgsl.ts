/**
 * THE SHADOW POOL'S FREE PAGES (#1527): the order a page request takes a physical page in is the
 * recency order of the pool's pages (`poolSlotRank`), made by the pool sort
 * (`../../../gpu/sort/sortWgsl.ts`) over the pool's pages, once a frame after the keep rule
 * (`vsmKeepPages`) and before the grant (`vsmGrantPages`).
 *
 * - A page no map holds — never drawn, its map gone, or not wanted for `shadowCacheMaxPageAgeSinceLastRequest` — is
 *   the oldest: taken first.
 * - A page holding a cached map is ranked by the frames since it was last wanted, a rank a frame:
 *   the least recently wanted first, pages of one frame in pool order, no level. Ages from
 *   `POOL_RANKS - 1` frames on share the last rank (`shadowCacheMaxPageAgeSinceLastRequest`, 1000, keeps a page younger).
 * - A page wanted this frame is in use: never listed, never taken.
 *
 * `vsmFreePages` holds the sort's words (`POOL_SORT_WORDS`, zero at creation), then the count of
 * free pages, the requests they fell short of, then the pages: the queue's head at the top, where `pmPop` takes it; then the sort's
 * scratch over the pool's pages (`poolScratchWords`).
 */
import { POOL_SORT_WORDS } from '../../../gpu/sort/sortWords.ts'
import { POOL_SORT_WGSL, poolSortWordsWgsl } from '../../../gpu/sort/sortWgsl.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

/** The free pages' count, the requests they fell short of this frame, and the pages, behind the
 *  sort's words; \`pmPop\` takes the top one. The one free stack of the shadow pools, over the atomic
 *  words of \`vsmFreePages\`: \`pmPop\` takes the top entry with one atomic subtraction: wait-free
 *  while the stack holds one. Where it held none (the old count, read signed, not above zero) the pop
 *  adds it back, tells the request it fell short of and returns −1: two atomics only when the pool
 *  is short, and a pop racing it there may find it short too. */
export const VSM_FREE_PAGES_WGSL = wgslBlock(
  'VSM_FREE_PAGES_WGSL',
  [],
  `const PM_FREE_COUNT:u32=${POOL_SORT_WORDS}u;
const PM_FREE_SHORT:u32=PM_FREE_COUNT+1u;
/** The free pages' first word: the stack's bottom entry. */
const PM_FREE_FIRST:u32=PM_FREE_COUNT+2u;
/** The free pages left less the requests none was left for: below zero when the pool fell short. */
fn pmFreeCount()->i32{return bitcast<i32>(atomicLoad(&vsmFreePages[PM_FREE_COUNT]))-bitcast<i32>(atomicLoad(&vsmFreePages[PM_FREE_SHORT]));}
/** Takes the next free page: < 0 when none is left. */
fn pmPop()->i32{
 let held=bitcast<i32>(atomicSub(&vsmFreePages[PM_FREE_COUNT],1u));
 if(held<=0i){
  atomicAdd(&vsmFreePages[PM_FREE_COUNT],1u);
  atomicAdd(&vsmFreePages[PM_FREE_SHORT],1u);
  return -1i;
 }
 return i32(atomicLoad(&vsmFreePages[PM_FREE_FIRST+u32(held-1i)]));
}
`,
)

/**
 * What the pool sort reads and writes for the shadow pool (`POOL_SORT_WGSL`'s host functions):
 * every pool page, its rank off its `vsmPoolPageInfo`, the whole pool a burst, and the queue
 * written top down into `vsmFreePages`.
 */
export const VSM_POOL_SORT_WGSL = wgslBlock(
  'VSM_POOL_SORT_WGSL',
  [
    POOL_SORT_WGSL,
    VSM_FREE_PAGES_WGSL,
    poolSortWordsWgsl(
      'vsmFreePages',
      (i) => i,
      (i) => `PM_FREE_FIRST+vsm.poolPages+${i}`,
    ),
  ],
  `fn poolSlotCount()->u32{return vsm.poolPages;}
/** The pool page slot \`j\` stands for: itself, or without \`lruAllocation\` the pool taken from its
 *  end, so that the sort's lower slot first lists the highest page first — the order a list popped
 *  from its tail hands the pages of the pool out in. */
fn poolPage(j:u32)->u32{return select(vsm.poolPages-1u-j,j,vsmPm.lruAllocation!=0u);}
/** Slot \`j\`'s rank: \`POOL_RANKS - 1\` for a page no map holds, \`POOL_RANKS\` for one wanted now, else
 *  its age less one, held to \`POOL_RANKS - 2\`; without \`lruAllocation\` a page not wanted now ranks 0
 *  (the pool is taken from its end, \`poolPage\`). */
fn poolSlotRank(j:u32)->u32{
 let info=vsmPoolPageInfo[poolPage(j)];
 if(info.flags==0u){return POOL_RANKS-1u;}
 let age=vsm.frameStamp-info.lastWantedStamp;
 if(age==0u){return POOL_RANKS;}
 return select(0u,min(age-1u,POOL_RANKS-2u),vsmPm.lruAllocation!=0u);
}
fn poolBurst()->u32{return vsm.poolPages;}
fn poolPlaced(total:u32){atomicStore(&vsmFreePages[PM_FREE_COUNT],total);atomicStore(&vsmFreePages[PM_FREE_SHORT],0u);}
/** The queue's entry \`at\` (0 its head) as the stack's \`total − 1 − at\`: the head is popped first. */
fn poolEmit(at:u32,j:u32){
 atomicStore(&vsmFreePages[PM_FREE_FIRST+atomicLoad(&vsmFreePages[PM_FREE_COUNT])-1u-at],poolPage(j));
}
`,
)
