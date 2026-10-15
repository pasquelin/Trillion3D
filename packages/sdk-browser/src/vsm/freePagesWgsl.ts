/**
 * THE SHADOW POOL'S FREE PAGES (#1527): the order a page request takes a physical page in is the
 * pool rank every GPU pool evicts by (`../gpu/pool/rank.ts`), made by the pool sort
 * (`../gpu/pool/sortWgsl.ts`) over the pool's pages, once a frame after the keep rule
 * (`vsmKeepPages`) and before the grant (`vsmGrantPages`).
 *
 * - A page no map holds — never drawn, its map gone, or not wanted for `VSM_PAGE_KEEP_FRAMES` — is
 *   the oldest: taken first.
 * - A page holding a cached map is ranked by the frames since it was last wanted, a doubling a
 *   step, its level the tier: the finer level first within a step.
 * - A page wanted this frame is in use: never listed, never taken.
 *
 * `vsmFreePages` holds the sort's words (`POOL_SORT_WORDS`, zero at creation), then the count of
 * free pages, the requests they fell short of, then the pages: the queue's head at the top, where `pmPop` takes it; then the sort's
 * scratch over the pool's pages (`poolScratchWords`).
 */
import { POOL_AGES } from '../gpu/pool/rank.ts'
import { POOL_SORT_WORDS } from '../gpu/pool/sortWords.ts'
import { POOL_SORT_WGSL, poolSortWordsWgsl } from '../gpu/pool/sortWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/**
 * THE ONE FREE STACK of the shadow pools, over the atomic words of \`buffer\`: its count at \`count\`,
 * its entries from \`first\`. \`<prefix>Take(n)\` takes the top n entries with one atomic subtraction
 * and returns the first one's rank: wait-free while the stack holds them. Where it held fewer (the
 * old count, read signed, under n) the take adds them back, tells its host (\`<prefix>Short(n)\`) and
 * returns −1: two atomics only when the pool is short, and a take racing it there may find it short
 * too. \`<prefix>At(i)\` reads entry i; \`<prefix>Push(v)\` gives one back. The physical pages'
 * (\`pmPop\`) and the transmission's blocks.
 */
export const freeStackWgsl = (prefix: string, buffer: string, count: string, first: string) =>
  wgslBlock(
    `freeStackWgsl(${prefix})`,
    [],
    `fn ${prefix}At(i:u32)->u32{return atomicLoad(&${buffer}[${first}+i]);}
fn ${prefix}Push(v:u32){atomicStore(&${buffer}[${first}+atomicAdd(&${buffer}[${count}],1u)],v);}
fn ${prefix}Take(n:u32)->i32{
 let held=bitcast<i32>(atomicSub(&${buffer}[${count}],n));
 if(held>=i32(n)){return held-i32(n);}
 atomicAdd(&${buffer}[${count}],n);
 ${prefix}Short(n);
 return -1i;
}`,
  )

/** The free pages' count, the requests they fell short of this frame, and the pages, behind the
 *  sort's words; \`pmPop\` takes the top one. */
export const VSM_FREE_PAGES_WGSL = wgslBlock(
  'VSM_FREE_PAGES_WGSL',
  [freeStackWgsl('pmFree', 'vsmFreePages', 'PM_FREE_COUNT', 'PM_FREE_FIRST')],
  `const PM_FREE_COUNT:u32=${POOL_SORT_WORDS}u;
const PM_FREE_SHORT:u32=PM_FREE_COUNT+1u;
/** The free pages' first word: the stack's bottom entry. */
const PM_FREE_FIRST:u32=PM_FREE_COUNT+2u;
fn pmFreeShort(n:u32){atomicAdd(&vsmFreePages[PM_FREE_SHORT],n);}
/** The free pages left less the requests none was left for: below zero when the pool fell short. */
fn pmFreeCount()->i32{return bitcast<i32>(atomicLoad(&vsmFreePages[PM_FREE_COUNT]))-bitcast<i32>(atomicLoad(&vsmFreePages[PM_FREE_SHORT]));}
/** Takes the next free page: < 0 when none is left. */
fn pmPop()->i32{
 let at=pmFreeTake(1u);
 if(at<0i){return -1i;}
 return i32(pmFreeAt(u32(at)));
}
`,
)

/**
 * What the pool sort reads and writes for the shadow pool (`POOL_SORT_WGSL`'s host functions):
 * every pool page, its age and tier off its `vsmPoolPageInfo`, the whole pool a burst, and the
 * queue written top down into `vsmFreePages`.
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
  `/** The age of a page no map holds: the last age step, the first taken. */
const PM_AGE_EMPTY:u32=0xffffffffu;
/** A kept page's age stops a step under the empty pages' (\`poolRank\`): taken after every one. */
const PM_AGE_KEPT_MAX:u32=${2 ** (POOL_AGES - 2) - 1}u;
fn poolSlotCount()->u32{return vsm.poolPages;}
/** Frames since the page was last wanted: 0 when wanted this frame (\`vsmKeepPages\`), in use. */
fn poolSlotAge(j:u32)->u32{
 let info=vsmPoolPageInfo[j];
 if(info.flags==0u){return PM_AGE_EMPTY;}
 return min(vsm.frameStamp-info.lastWantedStamp,PM_AGE_KEPT_MAX);
}
/** The page's level: its map's clipmap level (a local light's is 0), then its mip. */
fn poolSlotTier(j:u32)->u32{
 let info=vsmPoolPageInfo[j];
 if(info.flags==0u){return 0u;}
 return u32(max(vsmProjectionData[info.mapId].mapLevel,0i))+info.mipLevel;
}
/** Only a page wanted this frame is in use: one wanted last frame and not now may be taken. */
fn poolInUse()->u32{return 1u;}
fn poolBurst()->u32{return vsm.poolPages;}
fn poolPlaced(total:u32){atomicStore(&vsmFreePages[PM_FREE_COUNT],total);atomicStore(&vsmFreePages[PM_FREE_SHORT],0u);}
/** The queue's entry \`at\` (0 its head) as the stack's \`total − 1 − at\`: the head is popped first. */
fn poolEmit(at:u32,j:u32){
 atomicStore(&vsmFreePages[PM_FREE_FIRST+atomicLoad(&vsmFreePages[PM_FREE_COUNT])-1u-at],j);
}
`,
)
