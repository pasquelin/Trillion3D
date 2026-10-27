import { bitWords, ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type { BounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { TABLE_LANES } from '../atlas.ts'

/**
 * THE POOL'S SHAPES, a GPU pool of probes (`poolWgsl.ts`, `pool.ts`): which cells hold a probe, from the cells the image reads, and
 * which probes are traced each image. Everything the pool is made of lives on the GPU; the CPU reads back a few counters.
 */

/** Words a slot of the pool holds (`slots`): the entry plus one of the cell it holds — zero for a free slot; the entry the last pass's
 *  indirection named it by —, the cell's three coordinates, the frame that last read it, the frame that last traced it (zero: never) and
 *  its level. */
export const POOL_SLOT = {
  words: 7,
  owner: 0,
  cell: 1,
  usedAt: 4,
  tracedAt: 5,
  level: 6,
} as const

/** Priority buckets: the first holds the probes never traced. */
export const POOL_PRIORITY_BUCKETS = 16

/** What tracing a probe costs by where it stands: its map at half the side, at the whole side, at twice it — rays a side squared, so a
 *  quarter, one and four times the whole side's. The frame's budget is `normal` for each probe it names. */
export const POOL_COST = { downsampled: 1, normal: 4, supersampled: 16 } as const

/** The sizes of a pool of the levels `cascades` hold: `entries`, a cell of every level; `markWords`, the words of the marks' bitmap, a bit an
 *  entry; `tableTexels`, the texels of the table in the probes' atlas, `TABLE_LANES` entries each. */
export function poolShapeOf({ levels, cells }: Pick<BounceCascades, 'levels' | 'cells'>) {
  const entries = levels.length * cells
  return { entries, markWords: bitWords(entries), tableTexels: ceilDiv(entries, TABLE_LANES) }
}

/** The sizes of a pool (`poolShapeOf`). */
export type PoolShape = ReturnType<typeof poolShapeOf>

/**
 * The words of the pool's work buffer (`work`, atomic): the counters, the histogram and the stack of free slots.
 * What lasts from one image to the next: `free` (the slots on the stack), `refused` (the marks the pool had no probe left for, in all),
 * `high` (one past the highest slot ever given, which the slots' kernels are dispatched over, `POOL_ARGS.slots`), `changed` (the frame of
 * the last change of the lights: a probe traced before it is short of a trace) and the stack. The rest is cleared at the start of each pass: `queued`, the probes the image traces (its entries' count);
 * `spent`, the cost the probes first traced take, begun at the cheapest every one of them could cost, and `taken`, what the probes of the
 * bucket the budget stops in have taken of its room; the cut of the selection (`cut`: the bucket the budget stops in, `room`: what is left
 * of it for that bucket); `marked`, the cells the image marked; the tally the CPU reads (`live`, `unfilled`, `refreshing`: the probes not traced since the last change);
 * then the histogram of the probes by priority, each in its cost.
 * `stats` words from the first are what the CPU reads back.
 */
const COUNTERS = 13
export const POOL_WORK = {
  free: 0,
  refused: 1,
  queued: 2,
  spent: 3,
  taken: 4,
  cut: 5,
  room: 6,
  marked: 7,
  live: 8,
  unfilled: 9,
  refreshing: 10,
  high: 11,
  changed: 12,
  priority: COUNTERS,
  stack: COUNTERS + POOL_PRIORITY_BUCKETS,
  /** The counters the CPU reads back. */
  stats: COUNTERS,
} as const

/** Words of the work buffer for a pool of `slots` probes. */
export const poolWorkWords = (slots: number) => POOL_WORK.stack + slots

/** The slots on the stack at the start: all of them, the first slot on top. */
export function freshWork(slots: number) {
  const words = new Uint32Array(poolWorkWords(slots))
  words[POOL_WORK.free] = slots
  for (let at = 0; at < slots; at++) words[POOL_WORK.stack + at] = slots - 1 - at
  return words
}

/**
 * The uniform the pool's kernels read beside the levels' (`pool`): `room`, the frame's budget in cost (`probesPerFrame` times the cost of
 * a whole map, unlimited in a full update), `keep`, the frames a probe nothing reads is kept (`screenProbeRadianceCacheFramesToKeepProbes`);
 * `cap`, the probes the frame may queue (the block of its queue, `probeQueueShapeOf`: what its budget names, the whole pool in a full update); `fullUpdate`, whether every probe is
 * given back at the start of the pass (a full update); `distances`,
 * the squares of the distances, in metres, from the eye past which a probe is traced at half its side and within which it is traced at
 * twice it; `markDownsample`, the factors the image is downsampled by to mark the cells it reads where it cast no screen probe: the mark's,
 * on top of the interpolation's, then the interpolation's.
 */
export const POOL_PARAMS = fieldLayout('PoolParams', [
  ['room', 'u32'],
  ['keep', 'u32'],
  ['cap', 'u32'],
  ['fullUpdate', 'u32'],
  ['distances', 'vec2f'],
  ['markDownsample', 'vec2u'],
] as const)
/** Bytes of the pool's parameters. */
export const POOL_PARAMS_BYTES = POOL_PARAMS.words * 4

/** The pool's bindings (`POOL_SHADER`): the levels' uniform, the parameters, the slots, the table (the cell's slot plus one in the low 16 bits,
 *  the slot the GPU reads for it in the high 16: zero for none), the work buffer, the marks' bitmap, the probe queue and the published
 *  table (`../atlas.ts`), which the high halves of the table are written into. */
export const POOL_BINDINGS = {
  grid: 0,
  params: 1,
  slots: 2,
  table: 3,
  work: 4,
  marks: 5,
  queue: 6,
  published: 7,
} as const

/** The finish pass's bindings (`POOL_FINISH_SHADER`): the work buffer, the arguments of the dispatches over the queue and the levels'
 *  uniform, written. */
export const FINISH_BINDINGS = { work: 0, args: 1, grid: 2 } as const

/** The mark pass over the image's depth (`MARK_IMAGE_SHADER`): the levels' uniform, the view's, the depth, the pool's parameters, the bitmap. */
export const MARK_IMAGE_BINDINGS = { grid: 0, view: 1, depth: 2, params: 3, marks: 4 } as const

/** The mark pass over the last image's screen probes (`MARK_PROBES_SHADER`): the levels' uniform, the probes the last image cast
 *  (their count and the most adaptive ones), their records and the number of adaptive ones placed, the bitmap. */
export const MARK_PROBES_BINDINGS = {
  grid: 0,
  source: 1,
  info: 2,
  counts: 3,
  marks: 4,
} as const

/** The arguments of the dispatches over the probes the image traces, in words from each one's start: the probes (one group each), the
 *  kernels over the slots ever given (a thread a slot). */
export const POOL_ARGS = { probes: 0, slots: 3, words: 6 } as const

/** The budget of a full update, in cost: no limit. */
const UNLIMITED = 0xffffffff

/**
 * What a frame's pass is limited by (`POOL_PARAMS`): `room`, the budget in cost; `cap`, the probes it may queue, which the block of its
 * queue holds (`probeQueueShapeOf`); `fullUpdate`, whether every probe is given back. A full update has no budget, queues the whole pool
 * and gives every probe back.
 */
export const poolLimits = (probesPerFrame: number, full: boolean, cap: number) => ({
  room: full ? UNLIMITED : probesPerFrame * POOL_COST.normal,
  cap,
  fullUpdate: full ? 1 : 0,
})
