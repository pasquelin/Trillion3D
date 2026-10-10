import type { StreamContext } from './types.ts'
import type { PageCache } from './pageCache.ts'
import { createStreamingPins } from './streamingPins.ts'

/** A session's side of the page cache: its reserve and its holds. Its reserve — its manifest
 *  tables, its transfer queue and the engine's host tables, beside its pages — is told the cache
 *  each time it moves; the cache evicts (`PageCache.fit`), and tells the session each page that
 *  left. */
export function createStreamingCache(context: StreamContext) {
  const { store, state, pinned, jobs, emit, onEvict, maxTransferBytes } = context
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
      maxCachedBytes: store.budgetBytes,
      pinned: pinned.size,
      loading: state.active,
    }))
  }
  const evict = store.fit
  /** What the session reserves off the cache's total beside its pages. */
  const reserved = () => state.tableBytes + maxTransferBytes + state.engineBytes
  const session = { evicted, blocked }
  let seat: ReturnType<PageCache['open']> | undefined
  const told = () => seat?.reserve(reserved())
  /** The catalogue's tables grew by `bytes`, or shrank (`manifestTables.ts`). */
  const tables = (bytes: number) => {
    state.tableBytes += bytes
    told()
  }
  /** The engine's host tables take `bytes` of the CPU share the cache holds
   *  (`../residency/memoryBudget.ts`): the decoded pages keep the rest. Told the cache only once
   *  they moved: those tables follow the view, and its frame says them each time. */
  const reserve = (bytes: number) => {
    if (bytes === state.engineBytes) return
    state.engineBytes = bytes
    told()
  }
  /** The session reads through the cache from now on, its reserve off the total. */
  const open = () => void (seat = store.open(session, reserved()))
  /** The session's holds end with it: what it pinned or read stays cached for the next one. */
  const close = () => {
    for (const url of holding) store.release(url)
    holding.clear()
    seat?.leave()
    seat = undefined
  }
  const { pin, unpin, retainRanks } = createStreamingPins(context, sync, evict)
  return { evict, sync, drop, tables, open, close, pin, unpin, retainRanks, reserve }
}
