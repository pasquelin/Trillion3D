import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { POOL_SORT_WGSL, poolSortWordsWgsl } from '../../gpu/pool/sortWgsl.ts'
import { POOL_SORT_WORDS } from '../../gpu/pool/sortWords.ts'
import { EVICT_IN_USE } from '../../gpu/pool/rank.ts'
import { DAG_READBACK_SLOTS } from '../../gpu/dag/layout.ts'
import { SELECTION_HEADER_WORDS } from '../../gpu/dag/readoutWords.ts'
import { ROW_PAGE, ROW_USE, ROW_USE_WORDS } from './rowWords.ts'

/** Frames a row stays in use after the last cut that stamped it: the pool's rule (`EVICT_IN_USE`),
 *  past the frames the host reads the cut behind (`DAG_READBACK_SLOTS`) — the queue is taken that
 *  many frames after the GPU ranked it, and a row taken counts for the frame being drawn. */
export const ROW_IN_USE = EVICT_IN_USE + DAG_READBACK_SLOTS

/** Frames the host remembers a cut by, past the frames its readback lands behind it
 *  (`DAG_READBACK_SLOTS`) with room: the one span of the rings the cut's eviction keeps of the cuts
 *  that could not stamp (`rowEviction.ts`) and the rows' order of their arrivals (`rowOrder.ts`) —
 *  a queue is trusted only while both still hold its frame. */
export const ROW_FRAMES = 8

/** Frame `frame`'s place in a ring of `ROW_FRAMES`, a negative frame included. */
export const rowFrameSlot = (frame: number) => ((frame % ROW_FRAMES) + ROW_FRAMES) % ROW_FRAMES

/**
 * THE ROWS' VICTIM QUEUE (#1527): the pool sort (`../../gpu/pool/sortWgsl.ts`) over the live rows
 * `[0, slots)`, each ranked on its age — the clock less its last use, raised by the cut's closure
 * (`rowClosureWgsl.ts`) — in one tier: a row a cut used less than `ROW_IN_USE` frames ago is never
 * listed. The queue names each victim by the page its row holds (`ROW_PAGE`), so a row moved since
 * is still taken by its page, and lands in the cut's readout (`rowQueueWord`): its count, the rows
 * ranked in all, the clock plus one — what tells a queue of this cut from an older one —, then at
 * most a burst of pages (`rowBurst`). The uniform: the clock, the live rows, the queue's first word
 * in `out`, the burst.
 */
export const ROW_SORT_WGSL = wgslProgram(
  `struct RowSortUni{clock:u32,slots:u32,queueAt:u32,burst:u32,}
@group(0) @binding(0) var<storage,read> rowUse:array<u32>;
@group(0) @binding(1) var<storage,read_write> sortWords:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read_write> out:array<u32>;
@group(0) @binding(3) var<uniform> sortUni:RowSortUni;
${wgslConsts({ ROW_USE_WORDS, ROW_USE, ROW_PAGE, ROW_IN_USE, ROW_HEAD: SELECTION_HEADER_WORDS })}
fn poolSlotCount()->u32{return sortUni.slots;}
fn poolSlotAge(j:u32)->u32{return sortUni.clock-min(rowUse[ROW_USE_WORDS*j+ROW_USE],sortUni.clock);}
fn poolSlotTier(j:u32)->u32{return 0u;}
fn poolInUse()->u32{return ROW_IN_USE;}
fn poolBurst()->u32{return sortUni.burst;}
fn poolPlaced(total:u32){
 out[sortUni.queueAt]=min(total,sortUni.burst);out[sortUni.queueAt+1u]=total;out[sortUni.queueAt+2u]=sortUni.clock+1u;
}
fn poolEmit(at:u32,j:u32){out[sortUni.queueAt+ROW_HEAD+at]=rowUse[ROW_USE_WORDS*j+ROW_PAGE];}
`,
  [
    POOL_SORT_WGSL,
    poolSortWordsWgsl(
      'sortWords',
      (i) => i,
      (i) => `${POOL_SORT_WORDS}u+${i}`,
    ),
  ],
)
