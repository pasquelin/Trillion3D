import type { StreamContext } from './types.ts'
import { createStreamingPins } from './streamingPins.ts'

/** A session's side of the page cache: its reserve and its holds. `reserved` is what it takes off
 *  the total beside its pages; the cache evicts (`PageCache.fit`), and tells the session each page
 *  that left. */
export function createStreamingCache(context: StreamContext, reserved: () => number) {
  const { store, state, maxPages, pinned, jobs, emit, onEvict } = context
  /** The pages this session holds in the cache: those the frame keeps and those in flight, one
   *  hold each, whatever keeps it. */
  const holding = new Set<string>()
  /** `url`'s hold follows its pin and its transfer: taken when one starts, given back when both
   *  ended. */
  const sync = (url: string) => {
    const wanted = pinned.has(url) || jobs.has(url)
    if (wanted === holding.has(url)) return
    if (wanted) {
      holding.add(url)
      store.acquire(url)
    } else {
      holding.delete(url)
      store.release(url)
    }
  }
  /** The page at `url` leaves the cache, its hold with it: taken again while the session still
   *  pins or reads it. */
  const drop = (url: string) => {
    store.drop(url)
    holding.delete(url)
    sync(url)
  }
  const evicted = (url: string) => {
    state.evictions++
    emit?.('page-cache-eviction', 'Page evicted from the LRU cache', () => ({
      version: 1,
      url,
      reason: 'capacity',
      drawDetached: false,
      resident: store.pageCount,
      residentBytes: store.bytes,
      maxPages: maxPages ?? null,
      maxCachedBytes: store.budgetBytes,
    }))
    onEvict?.(url)
  }
  const blocked = () => {
    state.admissionBlocked++
    emit?.('page-cache-admission-blocked', 'No evictable page to meet the budget', () => ({
      version: 1,
      resident: store.pageCount,
      residentBytes: store.bytes,
      maxPages: maxPages ?? null,
      maxCachedBytes: store.budgetBytes,
      pinned: pinned.size,
      loading: state.active,
    }))
  }
  const evict = store.fit
  /** The engine's host tables take `bytes()` of the CPU share the cache holds
   *  (`../residency/memoryBudget.ts`): the decoded pages keep the rest. Read each time the cache
   *  weighs itself, for tables that follow the view. */
  const reserve = (bytes: () => number) => {
    state.reservedBytes = bytes
    evict()
  }
  const session = { reserved, maxPages, evicted, blocked }
  let leave = () => {}
  /** The session reads through the cache from now on, its reserve off the total. */
  const open = () => void (leave = store.open(session))
  /** The session's holds end with it: what it pinned or read stays cached for the next one. */
  const close = () => {
    for (const url of holding) store.release(url)
    holding.clear()
    leave()
  }
  const { retain, retainRanks } = createStreamingPins(context, sync, evict)
  return { evict, sync, drop, open, close, retain, retainRanks, reserve }
}
