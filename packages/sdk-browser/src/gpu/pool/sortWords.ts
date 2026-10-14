import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { POOL_RANKS } from './rank.ts'

/**
 * The sizes of a pool's victim queue (`sort.ts`), without its shader text: only constants and
 * arithmetic, so the hosts that size its buffers — the shadows' memory budget among them — read
 * them without the kernels.
 */
/** The sort's words: `POOL_RANKS` counts, as many places, the boundary rank and the total. */
export const POOL_SORT_BOUND = 2 * POOL_RANKS
export const POOL_SORT_TOTAL = POOL_SORT_BOUND + 1
export const POOL_SORT_WORDS = POOL_SORT_TOTAL + 1

/** Slots a counting, grouping or spreading workgroup takes: one a lane of the count's. */
export const POOL_LANES = 256

/** The sort's scratch over at most `slots` slots and a burst of `burst`: a rank and a slot per
 *  slot staged — fewer than a burst —, then two counts per group of `POOL_LANES` slots. */
export const poolScratchWords = (slots: number, burst: number) =>
  2 * burst + 2 * workgroupCount(slots, POOL_LANES)
