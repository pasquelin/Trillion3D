import { POOL_RANKS } from './rank.ts'

/**
 * CPU mirror of the pool sort (`sortWgsl.ts`): each group of `lanes` counts its slots' ranks, then
 * adds them to the global counters; the ranks are placed from the highest down; each slot then
 * takes its rank's next place, those under `burst` named. `rankOf(j)` is slot `j`'s rank,
 * `POOL_RANKS` in use. Within a rank, slot order, as the GPU's stable sort gives it. Returns the
 * queue of slots and the total ranked.
 */
export function sortPool(slots: number, rankOf: (j: number) => number, burst: number, lanes = 256) {
  const counts = new Uint32Array(POOL_RANKS),
    places = new Uint32Array(POOL_RANKS),
    local = new Uint32Array(POOL_RANKS)
  for (let first = 0; first < slots; first += lanes) {
    local.fill(0)
    for (let j = first; j < Math.min(slots, first + lanes); j++) {
      const rank = rankOf(j)
      if (rank < POOL_RANKS) local[rank]++
    }
    for (let r = 0; r < POOL_RANKS; r++) counts[r] += local[r]
  }
  let total = 0
  for (let r = POOL_RANKS - 1; r >= 0; r--) {
    places[r] = total
    total += counts[r]
  }
  const queue: number[] = []
  for (let j = 0; j < slots; j++) {
    const rank = rankOf(j)
    if (rank >= POOL_RANKS || places[rank] >= burst) continue
    queue[places[rank]++] = j
  }
  return { queue: queue.slice(0, Math.min(total, burst)), total, places }
}
