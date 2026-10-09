import { createHeap } from '../../../math/src/sequence/heap.ts'

/** One entry of a cache: its value — absent while it is only held, before it lands —, its bytes,
 *  how many hold it, its last touch, and its place in the heap, −1 out of it. */
type CacheEntry<V> = {
  readonly key: string
  value: V | undefined
  bytes: number
  holds: number
  stamp: number
  slot: number
}

/**
 * THE ENTRIES OF EVERY HOST-MEMORY CACHE — the page cache's pages, the files its ranged reads keep
 * whole and the scene proxy it keeps (`pageCache.ts`), the decoded texture levels
 * (`texture/levelStore.ts`) and the impostor atlases (`impostor/feed.ts`): one map of refcounted
 * entries, and the one heap of those no one holds, least recently touched first. Each cache weighs
 * them against its own budget: `evict` takes the oldest while its owner says it is over.
 *
 * Each touch stamps its entry with a counter that only grows: the stamps are the recency order. An
 * entry leaves the heap the moment it is held (`acquire`) and comes back at its stamp the moment
 * its last hold ends (`release`), so the heap never holds a held entry and its top is always the
 * least recently touched entry that may leave. A key held before its value lands — a page pinned
 * or in flight — is an entry with no value: it lands held. `drop` takes an entry out whole, its
 * holds with it.
 *
 * Costs, n the entries:
 * - `touch`: O(1) when the entry is already the newest — a page read every frame —, else one heap
 *   settle, O(log n), no allocation;
 * - `set`, `drop`, `acquire`, `release`: one heap insertion or removal at most, O(log n);
 * - `evict`: O(log n) per entry it takes, plus one `over()` per entry and one to stop, whatever
 *   the entries held: none is ever looked at;
 * - `bytes`, `heldBytes`, `size`: running totals, O(1) to read.
 */
export function createCacheEntries<V>(left: (value: V, key: string) => void = () => {}) {
  const entries = new Map<string, CacheEntry<V>>()
  const heap = createHeap<CacheEntry<V>>(
    (a, b) => a.stamp < b.stamp,
    (entry, at) => (entry.slot = at),
  )
  let next = 0,
    bytes = 0,
    heldBytes = 0,
    size = 0
  const unheap = (entry: CacheEntry<V>) => {
    if (entry.slot < 0) return
    heap.take(entry.slot)
    entry.slot = -1
  }
  /** `entry`'s value leaves, its bytes with it, told to `left`; the entry stays. */
  const vacate = (entry: CacheEntry<V>) => {
    const value = entry.value!
    bytes -= entry.bytes
    if (entry.holds > 0) heldBytes -= entry.bytes
    size--
    entry.value = undefined
    entry.bytes = 0
    left(value, entry.key)
  }
  /** `entry` leaves whole, its holds with it. */
  const remove = (entry: CacheEntry<V>) => {
    entries.delete(entry.key)
    unheap(entry)
    if (entry.value !== undefined) vacate(entry)
  }
  const entryOf = (key: string) => {
    let entry = entries.get(key)
    if (!entry) {
      entry = { key, value: undefined, bytes: 0, holds: 0, stamp: -1, slot: -1 }
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
    entry: (key: string): Readonly<CacheEntry<V>> | undefined => entries.get(key),
    /** The value at `key`, marked used last. */
    touch(key: string) {
      const entry = entries.get(key)
      if (entry?.value === undefined) return undefined
      if (entry.stamp !== next - 1) {
        entry.stamp = next++
        if (entry.slot >= 0) heap.settle(entry.slot)
      }
      return entry.value
    },
    /** Puts `value`, `weight` bytes, at `key` as the most recently used, in place of any value
     *  there: its holds stay. */
    set(key: string, value: V, weight: number) {
      const entry = entryOf(key)
      if (entry.value !== undefined) vacate(entry)
      entry.value = value
      entry.bytes = weight
      entry.stamp = next++
      bytes += weight
      size++
      if (entry.holds > 0) heldBytes += weight
      else if (entry.slot >= 0) heap.settle(entry.slot)
      else heap.push(entry)
    },
    /** `key`'s value now weighs `weight` bytes. */
    resize(key: string, weight: number) {
      const entry = entries.get(key)
      if (entry?.value === undefined) return
      bytes += weight - entry.bytes
      if (entry.holds > 0) heldBytes += weight - entry.bytes
      entry.bytes = weight
    },
    /** One more holds `key`, held before its value lands too: no eviction takes it until the last
     *  hold ends. */
    acquire(key: string) {
      const entry = entryOf(key)
      if (entry.holds++ > 0 || entry.value === undefined) return
      unheap(entry)
      heldBytes += entry.bytes
    },
    /** One hold on `key` ends: the last one puts it back at its last touch's place, or ends an
     *  entry that never landed. */
    release(key: string) {
      const entry = entries.get(key)
      if (!entry || entry.holds === 0 || --entry.holds > 0) return
      if (entry.value === undefined) return void entries.delete(key)
      heldBytes -= entry.bytes
      heap.push(entry)
    },
    /** `key` leaves, value and holds alike. */
    drop(key: string) {
      const entry = entries.get(key)
      if (entry) remove(entry)
    },
    /** Takes the least recently used value no one holds while `over(it)`, each told to `evicted`
     *  once it left. Returns how many left. */
    evict(over: (oldest: V) => boolean, evicted?: (key: string, value: V) => void) {
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
