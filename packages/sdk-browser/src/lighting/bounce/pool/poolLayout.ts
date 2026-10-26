import { bitWords, ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import {
  BOUNCE_PROBE_QUEUE,
  BOUNCE_SETTINGS,
} from '../../../../../sdk-core/src/bounce/contracts.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { TABLE_LANES } from '../atlas.ts'

/**
 * THE POOL'S SHAPES, a GPU pool of probes (`poolWgsl.ts`, `pool.ts`): which cells hold a probe, from the cells the image reads, and
 * which probes are traced each image. Everything the pool is made of lives on the GPU; the CPU reads back a few counters.
 */

/** Words a slot of the pool holds (`slots`): the entry plus one of the cell it holds — zero for a free slot —, the cell's three
 *  coordinates, the image that last read it, the image that last traced it (zero: never), the traces it took since the lights last changed
 *  (at most `settledTraces`) and its level. */
export const POOL_SLOT = {
  words: 8,
  owner: 0,
  cell: 1,
  usedAt: 4,
  tracedAt: 5,
  traces: 6,
  level: 7,
} as const

/** Cells from the eye a probe never traced is told apart by, a bucket a cell, the farthest bucket the rest. */
export const POOL_DISTANCE_BUCKETS = 64
/** Priority buckets of a probe already traced. */
export const POOL_PRIORITY_BUCKETS = 16

/** What tracing a probe costs by where it stands: its map at half the side, at the whole side, at twice it — rays a side squared, so a
 *  quarter, one and four times the whole side's. The frame's budget is `normal` for each probe it names. */
export const POOL_COST = { downsampled: 1, normal: 4, supersampled: 16 } as const

const LEVELS = BOUNCE_SETTINGS.cascadeLevels
const SIDE = BOUNCE_SETTINGS.cascadeSize
/** Entries of the table: a cell of every level. */
const POOL_ENTRIES = LEVELS * SIDE ** 3
/** Words of the marks' bitmap: a bit an entry. */
export const POOL_MARK_WORDS = bitWords(POOL_ENTRIES)
/** Texels of the table in the probes' atlas: `TABLE_LANES` entries each. */
export const POOL_TABLE_TEXELS = ceilDiv(POOL_ENTRIES, TABLE_LANES)

/**
 * The words of the pool's work buffer (`work`, atomic): the counters, the histograms and the stack of free slots.
 * What lasts from one image to the next: `free` (the slots on the stack), `refused` (the marks the pool had no probe left for, in all),
 * `high` (one past the highest slot ever given, which the slots' kernels are dispatched over, `POOL_ARGS.slots`) and the stack. The rest is cleared at the start of each pass: `queued`, the probes the image traces (its entries' count);
 * `spent`, `waiting`, `eligible`, the cost the probes first traced take above their cheapest, the cost of all that wait and
 * their count; the cut of the selection of the probes never traced (`cutUntraced`: the bucket the budget stops in, `roomUntraced`: how
 * many of that bucket fit) and of the others'; `marked`, the cells the image marked; the tally the CPU reads (`live`, `unfilled`, `refreshing`);
 * then the histograms — the probes never traced by level and distance, the others by priority, each in its cost.
 * `stats` words from the first are what the CPU reads back.
 */
const COUNTERS = 16
export const POOL_WORK = {
  free: 0,
  refused: 1,
  queued: 2,
  spent: 3,
  waiting: 4,
  eligible: 5,
  cutUntraced: 6,
  roomUntraced: 7,
  cutTraced: 8,
  roomTraced: 9,
  marked: 10,
  live: 11,
  unfilled: 12,
  refreshing: 13,
  high: 14,
  untraced: COUNTERS,
  traced: COUNTERS + LEVELS * POOL_DISTANCE_BUCKETS,
  stack: COUNTERS + LEVELS * POOL_DISTANCE_BUCKETS + POOL_PRIORITY_BUCKETS,
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
 * a whole map) and `marking`, whether this image marks (the probes unread for `probeKeptMarks` images are given back); `distances`,
 * the squares of the distances, in metres, from the eye past which a probe is traced at half its side and within which it is traced at
 * twice it.
 */
export const POOL_PARAMS = fieldLayout('PoolParams', [
  ['room', 'u32'],
  ['marking', 'u32'],
  ['distances', 'vec2f'],
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

/** The mark pass over the image's depth (`MARK_IMAGE_SHADER`): the levels' uniform, the view's, the depth and the normals, the bitmap. */
export const MARK_IMAGE_BINDINGS = { grid: 0, view: 1, depth: 2, normals: 3, marks: 4 } as const

/** The mark pass over the last image's screen probes (`MARK_PROBES_SHADER`): the levels' uniform, the probes the last image cast
 *  (their count and the most adaptive ones), their records and the number of adaptive ones placed, the bitmap. */
export const MARK_PROBES_BINDINGS = {
  grid: 0,
  source: 1,
  info: 2,
  normal: 3,
  counts: 4,
  marks: 5,
} as const

/** The arguments of the dispatches over the probes the image traces, in words from each one's start: the probes (one group each), the
 *  clear of the importance functions (a thread a word), the kernels over the slots ever given (a thread a slot). */
export const POOL_ARGS = { probes: 0, clear: 3, slots: 6, words: 9 } as const

/** The queue's entries, at most: those the radiance cache's kernels are dispatched over. */
export const POOL_QUEUE = BOUNCE_PROBE_QUEUE
