import { createEviction } from '../page/eviction.ts'

/** What a pool holds of an occupied slot, keyed by number: the key, and the pool's arrival count
 *  when it arrived — a slot taken after the queue's cut is never its victim. */
type SlotHeld = { readonly key: number; readonly generation: number }

/**
 * THE VICTIM ORDER OF A GPU POOL KEYED BY NUMBER — a tile pool's places, the row table's pages: the
 * queue the GPU ranked over its slots (`sortWgsl.ts`; `../../webgpu/tile/evictSortWgsl.ts`,
 * `../../webgpu/row/rowEvictSortWgsl.ts`), read back and taken by the one victim taker of every GPU
 * pool (`createEviction`). `generationOf` says what the pool holds at a key: its arrival count, or
 * `undefined` for a key it no longer holds. A key the queue lists that left, or was taken again
 * since the cut, is skipped. No clock and no recency on the CPU: the GPU stamped each slot where it
 * was read.
 *
 * The GPU also says how many slots it ranked in all (`total`), past the burst it lists: an order
 * spent whose total its victims took found nothing more to give (`exhausted`) — every other slot in
 * use —, where one whose total is larger only waits for the next.
 */
export function createSlotOrder(generationOf: (key: number) => number | undefined) {
  const eviction = createEviction<number, SlotHeld>({
    get(key) {
      const generation = generationOf(key)
      return generation === undefined ? undefined : { key, generation }
    },
  })
  let keys = new Uint32Array(0),
    total = 0,
    taken = 0,
    followed = false
  /** The order `createEviction` follows: every listed slot may leave, whatever cut the frames
   *  draw — its `old` and `open` unsaid. */
  const order = { count: 0, arrivals: 0, keyAt: (at: number) => keys[at] }
  return {
    /** Evicts from now on in `queue`, the first victim first — copied: the readback it lies in is
     *  read again —, cut when the pool had seen `arrivals` arrivals, the GPU having ranked `ranked`
     *  slots, the keys listed by default. */
    follow(queue: Uint32Array, arrivals: number, ranked?: number) {
      const count = queue.length
      if (keys.length < count) keys = new Uint32Array(count)
      keys.set(queue)
      order.count = count
      order.arrivals = arrivals
      total = Math.max(count, ranked ?? count)
      taken = 0
      followed = true
      eviction.follow(order)
    },
    /** The key the next arrival takes the slot of, or `undefined` when the queue has none left. */
    victim() {
      const slot = eviction.victim()
      if (typeof slot === 'string') return undefined
      taken++
      return slot.key
    },
    /** How many victims the queue may still give: an upper bound. */
    victims: () => eviction.victims(),
    /** A key's rank in the queue, the first victim at 0; `undefined` when unlisted — in use. */
    rankOf: (key: number) => eviction.rankOf(key),
    /** Whether the GPU found nothing more to give: an order followed, spent, its victims as many
     *  as the slots it ranked. Before any order, or with ranked slots left behind the burst, an
     *  arrival waits for the next one. */
    exhausted: () => followed && eviction.victims() === 0 && total <= taken,
  }
}
