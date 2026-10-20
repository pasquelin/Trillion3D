import { POOL_RANKS } from './rank.ts'
import { POOL_SORT_WGSL } from './sortWgsl.ts'
import { POOL_SORT_WORDS, poolScratchWords } from './sortWords.ts'
import { runPoolSort } from './sortRun.fixture.ts'
import { mulberry32 } from '../../../../math/src/sequence/random.ts'

/**
 * THE CONTRACT of a pool's victim queue (`sortWgsl.ts`), not its steps: every slot of the `slots`
 * whose rank `rankOf(j)` is under `POOL_RANKS`, the highest rank first, a rank's slots in slot
 * order; the first `burst` of them are the queue. Returns the queue and the total ranked.
 */
export function sortPool(slots: number, rankOf: (j: number) => number, burst: number) {
  // One key a ranked slot: the higher rank the smaller key, then the slot.
  const keys: number[] = []
  for (let j = 0; j < slots; j++) {
    const rank = rankOf(j)
    if (rank < POOL_RANKS) keys.push((POOL_RANKS - 1 - rank) * slots + j)
  }
  const queue = Float64Array.from(keys).sort().subarray(0, Math.max(0, burst))
  return { queue: Array.from(queue, (key) => key % slots), total: keys.length }
}

/** One run of the shipped sort (`sortRun.fixture.ts`) over the slots of `ranks` with a burst of
 *  `burst`, its threads in `seed`'s order: the queue, the total handed to the host, and the sort's
 *  words as it left them. */
export function shippedSort(ranks: readonly number[], burst: number, seed: number) {
  const words = new Array<number>(POOL_SORT_WORDS).fill(0),
    scratch = new Array<number>(poolScratchWords(ranks.length, burst)).fill(0)
  const queue: number[] = []
  let placed = -1
  runPoolSort(
    POOL_SORT_WGSL,
    [],
    {
      poolSlotRank: (j: number) => (j < ranks.length ? ranks[j] : POOL_RANKS),
      poolSlotCount: () => ranks.length,
      poolBurst: () => burst,
      poolCountAdd: (i: number, v: number) => ((words[i] += v), words[i] - v),
      poolCountLoad: (i: number) => words[i],
      poolCountStore: (i: number, v: number) => void (words[i] = v),
      poolScratchLoad: (i: number) => scratch[i],
      poolScratchStore: (i: number, v: number) => void (scratch[i] = v),
      poolPlaced: (total: number) => void (placed = total),
      poolEmit: (at: number, j: number) => {
        if (queue[at] !== undefined) throw new Error(`place ${at} listed twice`)
        queue[at] = j
      },
    },
    ranks.length,
    mulberry32(seed),
  )
  return { queue, placed, words }
}
