import { createHeap } from '../../../../math/src/sequence/heap.ts'

/** Eviction victims of one image, oldest first (last use, then index). */
export type VictimQueue = { readonly length: number; take(): number | undefined }

/** No victim: a lane before its first image. */
export const NO_VICTIMS: VictimQueue = { length: 0, take: () => undefined }

/**
 * A pool's victims on the engine's one heap (`math/src/sequence/heap.ts`), keyed by
 * `lastUse · tiles + index` (exact: a 32-bit last use times a pool's places stays under 2⁵³), so
 * their order is the sort by last use, then index. Refilled every image: built in O(n), taken in
 * O(log n).
 */
export function createVictimHeap(tiles: number) {
  const heap = createHeap<number>((a, b) => a < b)
  const queue: VictimQueue = {
    get length() {
      return heap.size
    },
    take() {
      const top = heap.take()
      return top === undefined ? undefined : top % tiles
    },
  }
  return {
    /** Empties the heap for a new image. */
    clear: () => heap.clear(),
    /** Adds place `index`, last used at `lastUse`; `order` then makes the heap. */
    add: (lastUse: number, index: number) => heap.add(lastUse * tiles + index),
    /** The places added since `clear`, as the image's queue. */
    order() {
      heap.order()
      return queue
    },
  }
}
