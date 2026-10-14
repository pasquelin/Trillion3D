import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { POOL_SORT_WGSL, poolSortWordsWgsl } from '../../gpu/pool/sortWgsl.ts'
import { POOL_SORT_WORDS } from '../../gpu/pool/sortWords.ts'
import { EVICT_IN_USE } from '../../gpu/pool/rank.ts'
import { TILE_PLACE_WORD_WGSL, TILE_UNRANKED } from './slotUse.ts'

/** The most victims a tile pool's queue names: more places than a pass serves before the next
 *  queue comes back. */
export const TILE_BURST = 1024

/**
 * A tile pool's victim queue (#1527): the pool sort (`../../gpu/pool/sortWgsl.ts`) over the places
 * of one lane of an atlas (`slotUse.ts`), each ranked on its age — the clock less the last clock a
 * pixel read it — and its level, the finer first. A free or pinned place, or one read less than
 * `EVICT_IN_USE` clocks ago, is never listed. The queue lands at `queueAt` in `queues`: its count,
 * then at most `TILE_BURST` places. One dispatch set a lane, its uniform at a dynamic offset.
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
fn poolInUse()->u32{return ${EVICT_IN_USE}u;}
fn poolBurst()->u32{return ${TILE_BURST}u;}
fn poolPlaced(total:u32){queues[sortUni.queueAt]=min(total,${TILE_BURST}u);}
fn poolEmit(at:u32,j:u32){queues[sortUni.queueAt+1u+at]=j;}
`,
  [
    POOL_SORT_WGSL,
    TILE_PLACE_WORD_WGSL,
    poolSortWordsWgsl(
      'sortWords',
      (i) => i,
      (i) => `${POOL_SORT_WORDS}u+${i}`,
    ),
  ],
)
