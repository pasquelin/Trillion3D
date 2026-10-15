import type { StreamContext } from './types.ts'
import type { PageCache } from './pageCache.ts'
import { createStreamingPins } from './streamingPins.ts'

/** A session's side of the page cache: its reserve and its holds. Its reserve — its manifest
 *  tables, its transfer queue and the engine's host tables, beside its pages — is told the cache
 *  each time it moves; the cache evicts (`PageCache.fit`), and tells the session each page that
 *  left. Every owner of a page — a pin, a transfer — holds it in the cache's one refcount
 *  (`cacheEntries.ts`) directly; the session only lists them (`pinned`, `jobs`) to give them back
 *  at its close. */
export function createStreamingCache(context: StreamContext) {
  const { store, state, pinned, jobs, emit, onEvict, maxTransferBytes } = context
  /** The page at `url` leaves the cache, its holds with it: each taken again that the session's
   *  pins and transfer still own. */
  const drop = (url: string) => {
    store.drop(url)
    for (let n = (pinned.get(url) ?? 0) + (jobs.has(url) ? 1 : 0); n > 0; n--) store.acquire(url)
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
  /** The session's holds end with it, its pins' and its transfers': what it pinned or read stays
   *  cached for the next one. */
  const close = () => {
    for (const [url, owners] of pinned) for (let n = owners; n > 0; n--) store.release(url)
    for (const url of jobs.keys()) store.release(url)
    pinned.clear()
    seat?.leave()
    seat = undefined
  }
  const { pin, unpin, retainRanks } = createStreamingPins(context, evict)
  return { evict, drop, tables, open, close, pin, unpin, retainRanks, reserve }
}
