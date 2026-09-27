/** Eviction victims of one image, oldest first (last use, then index). */
export type VictimQueue = { readonly length: number; take(): number | undefined };

/** No victim: a lane before its first image. */
export const NO_VICTIMS: VictimQueue = { length: 0, take: () => undefined };

/**
 * A pool's victims as a binary min-heap of packed keys `lastUse · tiles + index` (exact: a
 * 32-bit last use times a pool's places stays under 2⁵³), so their order is the sort by last use,
 * then index. One buffer per pool, refilled every image: choosing victims allocates nothing,
 * builds in O(n) and takes in O(log n).
 */
export function createVictimHeap(tiles: number) {
  const heap = new Float64Array(tiles);
  let size = 0;
  const siftDown = (at: number) => {
    const key = heap[at];
    for (;;) {
      let child = 2 * at + 1;
      if (child >= size) break;
      if (child + 1 < size && heap[child + 1] < heap[child]) child++;
      if (heap[child] >= key) break;
      heap[at] = heap[child];
      at = child;
    }
    heap[at] = key;
  };
  const queue: VictimQueue = {
    get length() {
      return size;
    },
    take() {
      if (!size) return undefined;
      const top = heap[0];
      heap[0] = heap[--size];
      if (size) siftDown(0);
      return top % tiles;
    },
  };
  return {
    /** Empties the heap for a new image. */
    clear() {
      size = 0;
    },
    /** Adds place `index`, last used at `lastUse`; `order` then makes the heap. */
    add(lastUse: number, index: number) {
      heap[size++] = lastUse * tiles + index;
    },
    /** The places added since `clear`, as the image's queue. */
    order() {
      for (let at = (size >> 1) - 1; at >= 0; at--) siftDown(at);
      return queue;
    },
  };
}
