import { createHeap } from '../../../math/src/sequence/heap.ts'

/** A key's last touch and its place in the heap. */
type Stamp = { key: string; stamp: number; slot: number }

/**
 * THE EVICTION ORDER of every host-memory cache — the page cache past the pages its reading session
 * holds (pinned by its frame or in transfer, `cache.ts`), the decoded texture levels
 * (`texture/levelStore.ts`) and the impostor atlases past those being made (`impostor/feed.ts`):
 * least recently touched first, never one held.
 *
 * Each touch stamps its key with a counter that only grows: the stamps are the recency order. The
 * keys that may leave sit in the streaming engine's one heap (`math/src/sequence/heap.ts`), ordered
 * by stamp. A key is taken OUT of the heap the moment it becomes held (`hold`) and put back at its
 * stamp the moment it is let go (`release`), so the heap never holds a held key and its top is
 * always the least recently touched key that may leave.
 *
 * Costs, n the keys cached and h the keys held:
 * - `touch`, `drop`, `hold`, `release`: one heap insertion or removal each, O(log n);
 * - `evict`: O(log n) per key it evicts, plus one `over()` per key and one to stop — worst case
 *   of a single call included, since no held key is ever looked at, whatever h;
 * - `releaseAll`, when the session reading through the page cache changes (`pageCache.hold`):
 *   O(h log n), once per session opened or closed, never inside an eviction;
 * - `heldBytes`: a running total kept by the four operations above, O(1) to read.
 */
export function createEvictionOrder(sizeOf: (key: string) => number) {
  let next = 0,
    heldBytes = 0
  /** Each cached key's last touch, and its place in the heap, −1 while held. */
  const stamps = new Map<string, Stamp>()
  /** Keys held, cached or not yet: they never enter the heap. */
  const held = new Set<string>()
  /** The keys that may leave, the least recently touched first (`math/src/sequence/heap.ts`). */
  const heap = createHeap<Stamp>(
    (a, b) => a.stamp < b.stamp,
    (entry, at) => (entry.slot = at),
  )
  const insert = (entry: Stamp) => heap.push(entry)
  const remove = (entry: Stamp) => {
    if (heap.items[entry.slot] !== entry) return
    heap.take(entry.slot)
    entry.slot = -1
  }
  const drop = (key: string) => {
    const entry = stamps.get(key)
    if (!entry) return
    stamps.delete(key)
    if (held.has(key)) heldBytes -= sizeOf(key)
    else remove(entry)
  }
  const release = (key: string) => {
    if (!held.delete(key)) return
    const entry = stamps.get(key)
    if (!entry) return
    heldBytes -= sizeOf(key)
    insert(entry)
  }
  return {
    /** `key` is the most recently used; its bytes are cached (`sizeOf` reads them). */
    touch(key: string) {
      drop(key)
      const entry = { key, stamp: next++, slot: -1 }
      stamps.set(key, entry)
      if (held.has(key)) heldBytes += sizeOf(key)
      else insert(entry)
    },
    /** `key` left the cache; called while `sizeOf` still reads its bytes. */
    drop,
    /** No eviction may take `key` until it is released: a pin added, a transfer started, an atlas
     *  being made. */
    hold(key: string) {
      if (held.has(key)) return
      held.add(key)
      const entry = stamps.get(key)
      if (!entry) return
      heldBytes += sizeOf(key)
      remove(entry)
    },
    /** `key` may leave again, at its last touch's place: what held it is gone. */
    release,
    /** Nothing is held any more: the session holding the page cache changed (`pageCache.hold`). */
    releaseAll() {
      for (const key of held) release(key)
    },
    /** Bytes of the cached keys held, kept as a running total: no key is walked. */
    get heldBytes() {
      return heldBytes
    },
    /** Evicts the least recently used key no one holds while `over(it)`; `evict` takes it out of
     *  its cache. Returns how many left. */
    evict(over: (oldest: string) => boolean, evict: (key: string) => void) {
      let evicted = 0
      while (heap.size && over(heap.items[0].key)) {
        const { key } = heap.items[0]
        drop(key)
        evict(key)
        evicted++
      }
      return evicted
    },
    /** Every key left: the holds stay, they are their holder's. */
    clear() {
      stamps.clear()
      heap.clear()
      heldBytes = 0
    },
  }
}
