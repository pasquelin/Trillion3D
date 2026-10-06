import type { StreamContext } from './types.ts'
import { evictOldest } from './evictOldest.ts'
import { createStreamingPins } from './streamingPins.ts'

/** A session's side of the page cache: its budget, its holds and its evictions. `reserved` is what
 *  it takes off the total beside its pages; `holder` is what it hands `store.hold`. */
export function createStreamingCache(context: StreamContext, reserved: () => number) {
  const { store, cache, state, maxPages, pinned, jobs, emit, onEvict } = context
  const touch = store.touch
  /** The page budget, read once per eviction: it sums the engine's tables, which the pages
   *  leaving do not move. */
  let budget = 0
  const over = () => (!!maxPages && maxPages >= 1 && cache.size > maxPages) || store.bytes > budget
  const pinnedOrLoading = (url: string) => pinned.has(url) || jobs.has(url)
  /** While this session holds the cache, the cache's eviction order keeps its holds: each pin or
   *  transfer that starts or ends is marked there (`sync`), and neither an eviction nor `held`
   *  walks the pages. A session another one has replaced keeps its own reckoning, walking the
   *  pages as the order would not know its holds: it is closing. */
  const owns = () => store.holds(holder)
  const sync = (url: string) => {
    if (!owns()) return
    if (pinnedOrLoading(url)) store.order.hold(url)
    else store.order.release(url)
  }
  /** Bytes of the pages no eviction may take: those the frame keeps and those in flight. */
  const heldBytes = () => {
    if (owns()) return store.order.heldBytes
    let held = 0
    for (const [url, page] of cache) if (pinnedOrLoading(url)) held += page.byteLength
    return held
  }
  const evictOne = (url: string) => {
    store.drop(url)
    state.evictions++
    emit?.('page-cache-eviction', 'Page evicted from the LRU cache', () => ({
      version: 1,
      url,
      reason: 'capacity',
      drawDetached: false,
      resident: cache.size,
      residentBytes: store.bytes,
      maxPages: maxPages ?? null,
      maxCachedBytes: store.budgetBytes,
    }))
    onEvict?.(url)
  }
  /** What is held beside the pages yields to those the frame keeps or reads, before any page
   *  leaves, so none is evicted that fits once it has gone: it never costs the image a page.
   *  The decoded texture levels first, the least recently read first — read again when a
   *  tile asks and they fit —, then the kept file, read again after a device loss. A notice says
   *  what each gave back. */
  const yielded = (phase: string, message: string, bytes: number) => {
    budget = store.budgetBytes
    if (bytes > 0)
      emit?.(phase, message, () => ({
        version: 1,
        bytes,
        residentBytes: store.bytes,
        maxCachedBytes: budget,
        pinned: pinned.size,
        loading: state.active,
      }))
  }
  const yieldBeside = (held: number) => {
    yielded(
      'page-cache-levels-yielded',
      'Texture levels yield to the pages kept or in flight',
      store.levels.shedTo(store.levelRoom(held)),
    )
    const kept = store.keptBytes
    if (kept === 0 || held <= budget) return
    store.yieldKept()
    yielded(
      'page-cache-kept-yielded',
      'The kept file yields its bytes to the pages kept or in flight',
      kept,
    )
  }
  const evict = () => {
    budget = store.budgetBytes
    if (!over()) return
    // Nothing beside, nothing to yield: the pages are not walked.
    const held = store.besideBytes > 0 ? heldBytes() : 0
    if (held > budget) yieldBeside(held)
    const evicted = owns()
      ? store.order.evict(over, evictOne)
      : evictOldest(cache.keys(), over, pinnedOrLoading, evictOne)
    if (!evicted && over()) {
      state.admissionBlocked++
      emit?.('page-cache-admission-blocked', 'No evictable page to meet the budget', () => ({
        version: 1,
        resident: cache.size,
        residentBytes: store.bytes,
        maxPages: maxPages ?? null,
        maxCachedBytes: store.budgetBytes,
        pinned: pinned.size,
        loading: state.active,
      }))
    }
  }
  /** The engine's host tables take `bytes()` of the CPU share the cache holds
   *  (`../residency/memoryBudget.ts`): the decoded pages keep the rest. Read each time the cache
   *  weighs itself, for tables that follow the view. */
  const reserve = (bytes: () => number) => {
    state.reservedBytes = bytes
    evict()
  }
  const holder = { reserved, held: heldBytes, evict }
  const { retain, retainRanks } = createStreamingPins(context, sync, evict)
  return { touch, evict, sync, holder, retain, retainRanks, reserve }
}
