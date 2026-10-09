import { createHeap } from '../../../math/src/sequence/heap.ts'

/** One entry of a cache: its key, its value — absent while it is only held, before it lands —, its
 *  bytes, how many hold it, its tier, its last touch, and its place in the heap, −1 out of it. */
type CacheEntry<V, K> = {
  readonly key: K
  value: V | undefined
  bytes: number
  holds: number
  tier: number
  stamp: number
  slot: number
}

/**
 * THE ENTRIES OF EVERY CACHE — the host's page cache, its pages, the files its ranged reads keep
 * whole, the decoded texture levels and the scene proxy (`pageCache.ts`), and the impostor atlases
 * on the GPU (`impostor/feed.ts`): one map of refcounted entries, and the one heap of those no one
 * holds, the lowest tier first and, within a tier, the least recently touched first. Each cache
 * weighs them against its own budget: `evict` takes the first while its owner says it is over.
 *
 * Each touch stamps its entry with a counter that only grows: the stamps are the recency order. An
 * entry's tier, set with its value, says what leaves before it whatever their touches: a tier above
 * leaves only once every entry below that may leave has. An entry leaves the heap the moment it is
 * held (`acquire`) and comes back at its place the moment its last hold ends (`release`), so the
 * heap never holds a held entry and its top is always the first entry that may leave. A key held
 * before its value lands — a page pinned or in flight — is an entry with no value: it lands held.
 * `drop` takes an entry out whole, its holds with it.
 *
 * Costs, n the entries:
 * - `touch`: O(1) when the entry is already the newest — a page read every frame —, else one heap
 *   settle, O(log n), no allocation;
 * - `set`, `drop`, `acquire`, `release`: one heap insertion or removal at most, O(log n);
 * - `evict`: O(log n) per entry it takes, plus one `over()` per entry and one to stop, whatever
 *   the entries held: none is ever looked at;
 * - `bytes`, `heldBytes`, `size`: running totals, O(1) to read.
 *
 * Keys are strings — a page's address — unless the cache names another kind: a number keys an
 * entry without building a string on a lookup.
 */
export function createCacheEntries<V, K = string>(left: (value: V, key: K) => void = () => {}) {
  const entries = new Map<K, CacheEntry<V, K>>()
  const heap = createHeap<CacheEntry<V, K>>(
    (a, b) => (a.tier === b.tier ? a.stamp < b.stamp : a.tier < b.tier),
    (entry, at) => (entry.slot = at),
  )
  let next = 0,
    bytes = 0,
    heldBytes = 0,
    size = 0
  const unheap = (entry: CacheEntry<V, K>) => {
    if (entry.slot < 0) return
    heap.take(entry.slot)
    entry.slot = -1
  }
  /** `entry`'s value leaves, its bytes with it, told to `left`; the entry stays. */
  const vacate = (entry: CacheEntry<V, K>) => {
    const value = entry.value!
    bytes -= entry.bytes
    if (entry.holds > 0) heldBytes -= entry.bytes
    size--
    entry.value = undefined
    entry.bytes = 0
    left(value, entry.key)
  }
  /** `entry` leaves whole, its holds with it. */
  const remove = (entry: CacheEntry<V, K>) => {
    entries.delete(entry.key)
    unheap(entry)
    if (entry.value !== undefined) vacate(entry)
  }
  const entryOf = (key: K) => {
    let entry = entries.get(key)
    if (!entry) {
      entry = { key, value: undefined, bytes: 0, holds: 0, tier: 0, stamp: -1, slot: -1 }
      entries.set(key, entry)
    }
    return entry
  }
  return {
    /** Entries holding a value. */
    get size() {
      return size
    },
    /** Bytes of every value held. */
    get bytes() {
      return bytes
    },
    /** Bytes of the values someone holds: no eviction takes them. */
    get heldBytes() {
      return heldBytes
    },
    /** The entry at `key`, its value absent while it is only held; nothing is marked. */
    entry: (key: K): Readonly<CacheEntry<V, K>> | undefined => entries.get(key),
    /** The value at `key`, marked used last. */
    touch(key: K) {
      const entry = entries.get(key)
      if (entry?.value === undefined) return undefined
      if (entry.stamp !== next - 1) {
        entry.stamp = next++
        if (entry.slot >= 0) heap.settle(entry.slot)
      }
      return entry.value
    },
    /** Puts `value`, `weight` bytes, at `key` as the most recently used of its `tier`, in place of
     *  any value there: its holds stay. */
    set(key: K, value: V, weight: number, tier = 0) {
      const entry = entryOf(key)
      if (entry.value !== undefined) vacate(entry)
      entry.value = value
      entry.bytes = weight
      entry.tier = tier
      entry.stamp = next++
      bytes += weight
      size++
      if (entry.holds > 0) heldBytes += weight
      else if (entry.slot >= 0) heap.settle(entry.slot)
      else heap.push(entry)
    },
    /** `key`'s value now weighs `weight` bytes. */
    resize(key: K, weight: number) {
      const entry = entries.get(key)
      if (entry?.value === undefined) return
      bytes += weight - entry.bytes
      if (entry.holds > 0) heldBytes += weight - entry.bytes
      entry.bytes = weight
    },
    /** One more holds `key`, held before its value lands too: no eviction takes it until the last
     *  hold ends. */
    acquire(key: K) {
      const entry = entryOf(key)
      if (entry.holds++ > 0 || entry.value === undefined) return
      unheap(entry)
      heldBytes += entry.bytes
    },
    /** One hold on `key` ends: the last one puts it back at its last touch's place, or ends an
     *  entry that never landed. */
    release(key: K) {
      const entry = entries.get(key)
      if (!entry || entry.holds === 0 || --entry.holds > 0) return
      if (entry.value === undefined) return void entries.delete(key)
      heldBytes -= entry.bytes
      heap.push(entry)
    },
    /** `key` leaves, value and holds alike. */
    drop(key: K) {
      const entry = entries.get(key)
      if (entry) remove(entry)
    },
    /** Takes the first value no one holds — lowest tier, least recently used — while `over(it)`,
     *  each told to `evicted` once it left. Returns how many left. */
    evict(over: (oldest: V) => boolean, evicted?: (key: K, value: V) => void) {
      let count = 0
      while (heap.size && over(heap.items[0].value!)) {
        const entry = heap.items[0],
          value = entry.value!
        remove(entry)
        evicted?.(entry.key, value)
        count++
      }
      return count
    },
    /** Every entry leaves, each value told to `left`. */
    clear() {
      for (const { key, value } of entries.values()) if (value !== undefined) left(value, key)
      entries.clear()
      heap.clear()
      bytes = heldBytes = size = 0
    },
  }
}
