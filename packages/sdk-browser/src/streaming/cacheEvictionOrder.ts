/**
 * The page cache's eviction order: least recently touched first, past the pages the reading
 * session holds — pinned by its frame or in transfer (`cache.ts`).
 *
 * Each touch stamps its page with a counter that only grows, so the stamps order the pages exactly
 * as the cache's `Map` does (a touch re-inserts). The pages that may leave sit in an indexed binary
 * min-heap of stamps. A page is taken OUT of the heap the moment it becomes held (`hold`: a pin
 * added, a transfer started) and put back at its stamp the moment it is let go (`release`), so the
 * heap never holds a held page and its top is always the first page `evictOldest(pages.keys(),
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
  /** Each cached page's last touch. */
  const stamps = new Map<string, number>()
  /** Pages the session holds, cached or not yet: they never enter the heap. */
  const held = new Set<string>()
  /** The heap, as two aligned arrays, and each key's index in them. */
  const keys: string[] = [],
    order: number[] = []
  const at = new Map<string, number>()
  const place = (i: number, key: string, stamp: number) => {
    keys[i] = key
    order[i] = stamp
    at.set(key, i)
  }
  const up = (i: number) => {
    const key = keys[i],
      stamp = order[i]
    for (let parent = (i - 1) >> 1; i > 0 && order[parent] > stamp; parent = (i - 1) >> 1) {
      place(i, keys[parent], order[parent])
      i = parent
    }
    place(i, key, stamp)
  }
  const down = (i: number) => {
    const key = keys[i],
      stamp = order[i],
      n = keys.length
    for (let child = 2 * i + 1; child < n; child = 2 * i + 1) {
      if (child + 1 < n && order[child + 1] < order[child]) child++
      if (order[child] >= stamp) break
      place(i, keys[child], order[child])
      i = child
    }
    place(i, key, stamp)
  }
  const insert = (key: string, stamp: number) => {
    keys.push(key)
    order.push(stamp)
    up(keys.length - 1)
  }
  const remove = (key: string) => {
    const i = at.get(key)
    if (i === undefined) return
    at.delete(key)
    const lastKey = keys.pop()!,
      lastStamp = order.pop()!
    if (i === keys.length) return
    keys[i] = lastKey
    order[i] = lastStamp
    if (i > 0 && order[(i - 1) >> 1] > lastStamp) up(i)
    else down(i)
  }
  const drop = (key: string) => {
    if (!stamps.delete(key)) return
    if (held.has(key)) heldBytes -= sizeOf(key)
    else remove(key)
  }
  const release = (key: string) => {
    if (!held.delete(key)) return
    const stamp = stamps.get(key)
    if (stamp === undefined) return
    heldBytes -= sizeOf(key)
    insert(key, stamp)
  }
  return {
    /** `key` is the most recently used page; its bytes are cached (`sizeOf` reads them). */
    touch(key: string) {
      drop(key)
      const stamp = next++
      stamps.set(key, stamp)
      if (held.has(key)) heldBytes += sizeOf(key)
      else insert(key, stamp)
    },
    /** `key` left the cache; called while `sizeOf` still reads its bytes. */
    drop,
    /** No eviction may take `key` until it is released: a pin added, a transfer started. */
    hold(key: string) {
      if (held.has(key)) return
      held.add(key)
      if (!stamps.has(key)) return
      heldBytes += sizeOf(key)
      remove(key)
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
      while (keys.length && over()) {
        const key = keys[0]
        drop(key)
        evict(key)
        evicted++
      }
      return evicted
    },
    /** Every page left: the holds stay, they are the session's. */
    clear() {
      stamps.clear()
      at.clear()
      keys.length = 0
      order.length = 0
      heldBytes = 0
    },
  }
}
