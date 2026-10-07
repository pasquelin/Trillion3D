import { createHeap } from './heap.ts'

/** A page's last touch and its place in the heap. */
type Stamp = { key: string; stamp: number; slot: number }

/**
 * The page cache's eviction order: least recently touched first, past the pages the reading
 * session holds — pinned by its frame or in transfer (`cache.ts`).
 *
 * Each touch stamps its page with a counter that only grows, so the stamps order the pages exactly
 * as the cache's `Map` does (a touch re-inserts). The pages that may leave sit in the streaming
 * layer's one heap (`heap.ts`), ordered by stamp. A page is taken OUT of the heap the moment it
 * becomes held (`hold`: a pin added, a transfer started) and put back at its stamp the moment it
 * is let go (`release`), so the heap never holds a held page and its top is always the first page `evictOldest(pages.keys(),
 * over, held, …)` takes: the same victims, in the same order.
 *
 * Costs, n the pages cached and h the pages held:
 * - `touch`, `drop`, `hold`, `release`: one heap insertion or removal each, O(log n);
 * - `evict`: O(log n) per page it evicts, plus one `over()` per page and one to stop — worst case
 *   of a single call included, since no held page is ever looked at, whatever h;
 * - `releaseAll`, when the session reading through the cache changes (`pageCache.hold`): O(h log n),
 *   once per session opened or closed, never inside an eviction;
 * - `heldBytes`: a running total kept by the four operations above, O(1) to read.
 */
export function createEvictionOrder(sizeOf: (key: string) => number) {
  let next = 0,
    heldBytes = 0
  /** Each cached page's last touch, and its place in the heap, −1 while held. */
  const stamps = new Map<string, Stamp>()
  /** Pages the session holds, cached or not yet: they never enter the heap. */
  const held = new Set<string>()
  /** The pages that may leave, the least recently touched first (`heap.ts`). */
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
    /** `key` is the most recently used page; its bytes are cached (`sizeOf` reads them). */
    touch(key: string) {
      drop(key)
      const entry = { key, stamp: next++, slot: -1 }
      stamps.set(key, entry)
      if (held.has(key)) heldBytes += sizeOf(key)
      else insert(entry)
    },
    /** `key` left the cache; called while `sizeOf` still reads its bytes. */
    drop,
    /** No eviction may take `key` until it is released: a pin added, a transfer started. */
    hold(key: string) {
      if (held.has(key)) return
      held.add(key)
      const entry = stamps.get(key)
      if (!entry) return
      heldBytes += sizeOf(key)
      remove(entry)
    },
    /** `key` may leave again, at its last touch's place: its pin and its transfer are gone. */
    release,
    /** Nothing is held any more: the session holding the pages changed (`pageCache.hold`). */
    releaseAll() {
      for (const key of held) release(key)
    },
    /** Bytes of the cached pages held, kept as a running total: no page is walked. */
    get heldBytes() {
      return heldBytes
    },
    /** Evicts the least recently used page no one holds, while `over()`; `evict` takes it out of
     *  the cache. Returns how many left, as `evictOldest` does. */
    evict(over: () => boolean, evict: (key: string) => void) {
      let evicted = 0
      while (heap.size && over()) {
        const { key } = heap.items[0]
        drop(key)
        evict(key)
        evicted++
      }
      return evicted
    },
    /** Every page left: the holds stay, they are the session's. */
    clear() {
      stamps.clear()
      heap.clear()
      heldBytes = 0
    },
  }
}
