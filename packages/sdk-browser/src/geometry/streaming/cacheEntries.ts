import { createHeap } from '../../../../math/src/sequence/heap.ts'

/** One entry of a cache: its key, its value — absent while it is only held, before it lands —, its
 *  bytes, how many hold it, its last touch, and its place in the heap, −1 out of it. */
type CacheEntry<V, K> = {
  readonly key: K
  value: V | undefined
  bytes: number
  holds: number
  stamp: number
  slot: number
}

/** Whether entry `a` leaves before `b`: the older touch. */
const before = <V, K>(a: CacheEntry<V, K>, b: CacheEntry<V, K>) => a.stamp < b.stamp

/** What the entries keep: the map, the heap of those no one holds, and the running totals. */
interface Entries<V, K> {
  entries: Map<K, CacheEntry<V, K>>
  heap: ReturnType<typeof createHeap<CacheEntry<V, K>>>
  left: (value: V, key: K) => void
  next: number
  bytes: number
  heldBytes: number
  size: number
}

function unheap<V, K>(s: Entries<V, K>, entry: CacheEntry<V, K>) {
  if (entry.slot < 0) return
  s.heap.take(entry.slot)
  entry.slot = -1
}

/** `entry`'s value leaves, its bytes with it, told to `left`; the entry stays. */
function vacate<V, K>(s: Entries<V, K>, entry: CacheEntry<V, K>) {
  const value = entry.value!
  s.bytes -= entry.bytes
  if (entry.holds > 0) s.heldBytes -= entry.bytes
  s.size--
  entry.value = undefined
  entry.bytes = 0
  s.left(value, entry.key)
}

/** `entry` leaves whole, its holds with it. */
function remove<V, K>(s: Entries<V, K>, entry: CacheEntry<V, K>) {
  s.entries.delete(entry.key)
  unheap(s, entry)
  if (entry.value !== undefined) vacate(s, entry)
}

function entryOf<V, K>(s: Entries<V, K>, key: K) {
  let entry = s.entries.get(key)
  if (!entry) {
    entry = { key, value: undefined, bytes: 0, holds: 0, stamp: -1, slot: -1 }
    s.entries.set(key, entry)
  }
  return entry
}

function touchEntry<V, K>(s: Entries<V, K>, key: K) {
  const entry = s.entries.get(key)
  if (entry?.value === undefined) return undefined
  if (entry.stamp !== s.next - 1) {
    entry.stamp = s.next++
    if (entry.slot >= 0) s.heap.settle(entry.slot)
  }
  return entry.value
}

function setEntry<V, K>(s: Entries<V, K>, key: K, value: V, weight: number) {
  const entry = entryOf(s, key)
  if (entry.value !== undefined) vacate(s, entry)
  entry.value = value
  entry.bytes = weight
  entry.stamp = s.next++
  s.bytes += weight
  s.size++
  if (entry.holds > 0) s.heldBytes += weight
  else if (entry.slot >= 0) s.heap.settle(entry.slot)
  else s.heap.push(entry)
}

function resizeEntry<V, K>(s: Entries<V, K>, key: K, weight: number) {
  const entry = s.entries.get(key)
  if (entry?.value === undefined) return
  s.bytes += weight - entry.bytes
  if (entry.holds > 0) s.heldBytes += weight - entry.bytes
  entry.bytes = weight
}

function dropEntry<V, K>(s: Entries<V, K>, key: K) {
  const entry = s.entries.get(key)
  if (entry) remove(s, entry)
}

function clearEntries<V, K>(s: Entries<V, K>) {
  for (const { key, value } of s.entries.values()) if (value !== undefined) s.left(value, key)
  s.entries.clear()
  s.heap.clear()
  s.bytes = s.heldBytes = s.size = 0
}

function acquireEntry<V, K>(s: Entries<V, K>, key: K) {
  const entry = entryOf(s, key)
  if (entry.holds++ > 0 || entry.value === undefined) return
  unheap(s, entry)
  s.heldBytes += entry.bytes
}

function releaseEntry<V, K>(s: Entries<V, K>, key: K) {
  const entry = s.entries.get(key)
  if (!entry || entry.holds === 0 || --entry.holds > 0) return
  if (entry.value === undefined) return void s.entries.delete(key)
  s.heldBytes -= entry.bytes
  s.heap.push(entry)
}

function evictEntries<V, K>(
  s: Entries<V, K>,
  over: (oldest: V) => boolean,
  evicted?: (key: K, value: V) => void,
) {
  let count = 0
  for (let entry = s.heap.items[0]; entry && over(entry.value!); entry = s.heap.items[0]) {
    const value = entry.value!
    remove(s, entry)
    evicted?.(entry.key, value)
    count++
  }
  return count
}

/**
 * THE ENTRIES OF EVERY CACHE — the host's page cache, its pages, the files its ranged reads keep
 * whole, the decoded texture levels (`pageCache.ts`): one map of refcounted
 * entries, and the heap of those no one
 * holds, the least recently touched first. Each cache
 * weighs them against its own budget: `evict` takes the first while its owner says it is over.
 *
 * Each touch stamps its entry with a counter that only grows: the stamps are the recency order. An
 * entry leaves the heap the moment it is
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
 * - `bytes`, `heldBytes`, `size`, `heldCount`: running totals, O(1) to read.
 *
 * Keys are strings — a page's address — unless the cache names another kind: a number keys an
 * entry without building a string on a lookup.
 */
export function createCacheEntries<V, K = string>(left: (value: V, key: K) => void = () => {}) {
  const s: Entries<V, K> = {
    entries: new Map<K, CacheEntry<V, K>>(),
    heap: createHeap<CacheEntry<V, K>>(before, (entry, at) => (entry.slot = at)),
    left,
    next: 0,
    bytes: 0,
    heldBytes: 0,
    size: 0,
  }
  return {
    /** Entries holding a value. */
    get size() {
      return s.size
    },
    /** Bytes of every value held. */
    get bytes() {
      return s.bytes
    },
    /** Bytes of the values someone holds: no eviction takes them. */
    get heldBytes() {
      return s.heldBytes
    },
    /** Entries holding a value that someone holds: those the heap does not. */
    get heldCount() {
      return s.size - s.heap.size
    },
    /** The entry that leaves first — the least recently touched —, none held. */
    get first(): Readonly<CacheEntry<V, K>> | undefined {
      return s.heap.items[0]
    },
    /** The entry at `key`, its value absent while it is only held; nothing is marked. */
    entry: (key: K): Readonly<CacheEntry<V, K>> | undefined => s.entries.get(key),
    /** The value at `key`, marked used last. */
    touch: (key: K) => touchEntry(s, key),
    /** Puts `value`, `weight` bytes, at `key` as the most recently used, in place of
     *  any value there: its holds stay. */
    set: (key: K, value: V, weight: number) => setEntry(s, key, value, weight),
    /** `key`'s value now weighs `weight` bytes. */
    resize: (key: K, weight: number) => resizeEntry(s, key, weight),
    /** One more holds `key`, held before its value lands too: no eviction takes it until the last
     *  hold ends. */
    acquire: (key: K) => acquireEntry(s, key),
    /** One hold on `key` ends: the last one puts it back at its last touch's place, or ends an
     *  entry that never landed. */
    release: (key: K) => releaseEntry(s, key),
    /** `key` leaves, value and holds alike. */
    drop: (key: K) => dropEntry(s, key),
    /** Takes the first value no one holds — least recently used — while `over(it)`,
     *  each told to `evicted` once it left. Returns how many left. */
    evict: (over: (oldest: V) => boolean, evicted?: (key: K, value: V) => void) =>
      evictEntries(s, over, evicted),
    /** Every entry leaves, each value told to `left`. */
    clear: () => clearEntries(s),
  }
}
