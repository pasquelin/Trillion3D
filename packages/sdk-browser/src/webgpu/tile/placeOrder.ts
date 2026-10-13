import { createEviction } from '../../gpu/page/eviction.ts'

/** What a pool holds of an occupied place: its index, and the pool's arrival count when its tile
 *  arrived — a tile placed after the queue's cut is never its victim. */
type PlaceHeld = { readonly index: number; readonly generation: number }

/**
 * The victim order of a tile pool: the queue the GPU ranked over its places (`evictSortWgsl.ts`),
 * read back with the feedback (`feedback.ts`) and taken by the one victim taker of every GPU pool
 * (`createEviction`), keyed by place. A place the queue lists that was freed, or taken again since
 * the cut, is skipped. No clock and no recency on the CPU: the GPU stamped each place its pixels
 * read (`stampWgsl.ts`).
 */
export function createPlaceOrder(held: (index: number) => PlaceHeld | undefined) {
  const eviction = createEviction<number, PlaceHeld>({ get: held })
  let keys = new Uint32Array(0)
  /** The order `createEviction` follows: every listed place may leave (`old`), whatever cut the
   *  frames draw (`open`). */
  const order = {
    count: 0,
    old: 0,
    arrivals: 0,
    keyAt: (at: number) => keys[at],
    open: () => true,
  }
  return {
    /** Evicts from now on in `queue` — its count, then its places, the first victim first —, cut
     *  when the pool had seen `arrivals` arrivals. */
    follow(queue: Uint32Array, arrivals: number) {
      const count = Math.min(queue[0], queue.length - 1)
      if (keys.length < count) keys = new Uint32Array(count)
      keys.set(queue.subarray(1, 1 + count))
      order.count = order.old = count
      order.arrivals = arrivals
      eviction.follow(order)
    },
    /** The place the next arrival takes, or `undefined` when the queue has none left. */
    victim() {
      const page = eviction.victim()
      return typeof page === 'string' ? undefined : page.index
    },
    /** How many victims the queue may still give: an upper bound. */
    victims: () => eviction.victims(),
    /** A place's rank in the queue, the first victim at 0; `undefined` when unlisted — in use. */
    rankOf: (index: number) => eviction.rankOf(index),
  }
}
