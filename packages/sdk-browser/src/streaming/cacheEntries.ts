import { createHeap } from '../../../math/src/sequence/heap.ts'

/** One entry of a cache: its key, its value — absent while it is only held, before it lands —, its
 *  bytes, how many hold it, its tier, its last touch, its lane, and its place in its lane's heap,
 *  −1 out of it. */
type CacheEntry<V, K> = {
  readonly key: K
  value: V | undefined
  bytes: number
  holds: number
  tier: number
  stamp: number
  lane: number
  slot: number
}

/** Whether entry `a` leaves before `b`: the lower tier, then the older touch. */
const before = <V, K>(a: CacheEntry<V, K>, b: CacheEntry<V, K>) =>
  a.tier === b.tier ? a.stamp < b.stamp : a.tier < b.tier

/**
 * THE ENTRIES OF EVERY CACHE — the host's page cache, its pages, the files its ranged reads keep
 * whole, the decoded texture levels and the scene proxy (`pageCache.ts`), and the impostor atlases
 * on the GPU (`impostor/feed.ts`): one map of refcounted entries, and the heap of those no one
 * holds, the lowest tier first and, within a tier, the least recently touched first. Each cache
 * weighs them against its own budget: `evict` takes the first while its owner says it is over.
 * A cache whose bound counts one kind of entry alone — the host cache's pages — puts each kind in a
 * lane of its own (`laneOf`), one heap a lane: `evict` takes the first of every lane, or of one
 * lane alone, by the same order, so a bound on one kind never takes another.
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
 *   the entries held: none is ever looked at; one look per lane to find the first;
 * - `bytes`, `heldBytes`, `size`: running totals, O(1) to read.
 *
 * Keys are strings — a page's address — unless the cache names another kind: a number keys an
 * entry without building a string on a lookup.
 */
export function createCacheEntries<V, K = string>(
  left: (value: V, key: K) => void = () => {},
  laneOf: (value: V) => number = () => 0,
) {
  const entries = new Map<K, CacheEntry<V, K>>()
  type Heap = ReturnType<typeof createHeap<CacheEntry<V, K>>>
  /** The heap of each lane, made as its first entry comes. */
  const heaps: Heap[] = []
  const heapOf = (lane: number) =>
    (heaps[lane] ??= createHeap<CacheEntry<V, K>>(before, (entry, at) => (entry.slot = at)))
  let next = 0,
    bytes = 0,
    heldBytes = 0,
    size = 0
  const unheap = (entry: CacheEntry<V, K>) => {
    if (entry.slot < 0) return
    heaps[entry.lane].take(entry.slot)
    entry.slot = -1
  }
  /** The first entry that may leave — of `lane`, or of every lane. */
  const first = (lane?: number) => {
    if (lane !== undefined) return heaps[lane]?.items[0]
    let found: CacheEntry<V, K> | undefined
    for (const heap of heaps) {
      const top = heap?.items[0]
      if (top && (!found || before(top, found))) found = top
    }
    return found
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
      entry = { key, value: undefined, bytes: 0, holds: 0, tier: 0, stamp: -1, lane: 0, slot: -1 }
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
        if (entry.slot >= 0) heaps[entry.lane].settle(entry.slot)
      }
      return entry.value
    },
    /** Puts `value`, `weight` bytes, at `key` as the most recently used of its `tier`, in its lane,
     *  in place of any value there: its holds stay. */
    set(key: K, value: V, weight: number, tier = 0) {
      const entry = entryOf(key),
        lane = laneOf(value)
      if (entry.value !== undefined) vacate(entry)
      if (entry.lane !== lane) {
        unheap(entry)
        entry.lane = lane
      }
      entry.value = value
      entry.bytes = weight
      entry.tier = tier
      entry.stamp = next++
      bytes += weight
      size++
      if (entry.holds > 0) heldBytes += weight
      else if (entry.slot >= 0) heaps[lane].settle(entry.slot)
      else heapOf(lane).push(entry)
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
      heapOf(entry.lane).push(entry)
    },
    /** `key` leaves, value and holds alike. */
    drop(key: K) {
      const entry = entries.get(key)
      if (entry) remove(entry)
    },
    /** Takes the first value no one holds — lowest tier, least recently used —, of `lane` alone
     *  when one is named, while `over(it)`, each told to `evicted` once it left. Returns how many
     *  left. */
    evict(over: (oldest: V) => boolean, evicted?: (key: K, value: V) => void, lane?: number) {
      let count = 0
      for (let entry = first(lane); entry && over(entry.value!); entry = first(lane)) {
        const value = entry.value!
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
      for (const heap of heaps) heap?.clear()
      bytes = heldBytes = size = 0
    },
  }
}
