import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { POOL_RANKS } from '../../gpu/sort/rank.ts'
import { POOL_RANKS_WGSL } from '../../gpu/sort/rankWgsl.ts'
import { POOL_SORT_WGSL, poolSortWordsWgsl } from '../../gpu/sort/sortWgsl.ts'
import { POOL_SORT_WORDS } from '../../gpu/sort/sortWords.ts'
import { TILE_PLACE_WORD_WGSL, TILE_UNRANKED } from './slotUse.ts'

/** The most victims a tile pool's queue names: more places than a pass serves before the next
 *  queue comes back. The queue's count says every idle place, the burst or not. */
export const TILE_BURST = 1024

/** The clocks a tile's use protects its place for: a place no pixel read in the last
 *  `TILE_PROTECTED` clocks is in use, never listed. Pixels stamp the places they read at a sparse
 *  sample (`reduceWgsl.ts`), so a place still read may go unstamped for a few images. */
export const TILE_PROTECTED = 16

/** The ranks a tile pool tells apart: `TILE_TIERS` tiers (levels) in each of `TILE_AGES` age steps. */
export const TILE_TIERS = 32
const TILE_AGES = POOL_RANKS / TILE_TIERS

/** Slot `j`'s rank (the tests run this text over a stubbed `poolSlotAge` and `poolSlotTier`): `POOL_RANKS` while its age is under
 *  `TILE_PROTECTED`, else its age step then its tier, the finer level — higher rank — first, so a child leaves before its parent
 *  (#477). The age step is one a clock past the protection, the least recently read leaving first, exactly, over the steps the
 *  rank holds, those older all sharing the last. Integer only. */
const TILE_SLOT_RANK_WGSL = wgslFn(
  'poolSlotRank',
  [POOL_RANKS_WGSL],
  `fn poolSlotRank(j:u32)->u32{
 let age=poolSlotAge(j);
 if(age<${TILE_PROTECTED}u){return POOL_RANKS;}
 return min(age-${TILE_PROTECTED - 1}u,${TILE_AGES - 1}u)*${TILE_TIERS}u+(${TILE_TIERS - 1}u-min(poolSlotTier(j),${TILE_TIERS - 1}u));
}`,
)

/**
 * A tile pool's victim queue (#1527): the pool sort (`../../gpu/sort/sortWgsl.ts`) over the places
 * of one lane of an atlas (`slotUse.ts`), each ranked on its age — the clock less the last clock a
 * pixel read it — and its level, the finer first. A free or pinned place, or one read less than
 * `TILE_PROTECTED` clocks ago, is never listed. Its age step is the count of clocks past the
 * protection: the least recently read leaves first, exactly, over the 31
 * clocks that follow the protection, those older all sharing the last step. The queue lands at
 * `queueAt` in `queues`: its count, every place ranked, past the burst the queue lists (the pool's
 * idle share counts them all), then at most `TILE_BURST` places. One dispatch set a lane, its
 * uniform at a dynamic offset.
 */
export const TILE_SORT_WGSL = wgslProgram(
  `struct TileSortUni{base:u32,slots:u32,clock:u32,queueAt:u32,}
@group(0) @binding(0) var<storage,read> placeUse:array<u32>;
@group(0) @binding(1) var<storage,read_write> sortWords:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read_write> queues:array<u32>;
@group(0) @binding(3) var<uniform> sortUni:TileSortUni;
fn poolSlotCount()->u32{return sortUni.slots;}
fn poolSlotAge(j:u32)->u32{
 let at=tilePlaceWord(sortUni.base,j);
 if(placeUse[at+1u]==${TILE_UNRANKED}u){return 0u;}
 return sortUni.clock-min(placeUse[at],sortUni.clock);
}
fn poolSlotTier(j:u32)->u32{return placeUse[tilePlaceWord(sortUni.base,j)+1u];}
fn poolBurst()->u32{return ${TILE_BURST}u;}
fn poolPlaced(total:u32){queues[sortUni.queueAt]=total;}
fn poolEmit(at:u32,j:u32){queues[sortUni.queueAt+1u+at]=j;}
`,
  [
    POOL_SORT_WGSL,
    TILE_SLOT_RANK_WGSL,
    TILE_PLACE_WORD_WGSL,
    poolSortWordsWgsl(
      'sortWords',
      (i) => i,
      (i) => `${POOL_SORT_WORDS}u+${i}`,
    ),
  ],
)
