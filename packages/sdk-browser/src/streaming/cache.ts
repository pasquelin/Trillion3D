import type { StreamContext } from './types.ts'
import { createStreamingPins } from './streamingPins.ts'

/** A session's side of the page cache: its budget, its holds and its evictions. `reserved` is what
 *  it takes off the total beside its pages; `holder` is what it hands `store.attach`. */
export function createStreamingCache(context: StreamContext, reserved: () => number) {
  const { store, state, maxPages, pinned, jobs, emit, onEvict } = context
  /** The page budget, read once per eviction: it sums the engine's tables, which the pages
   *  leaving do not move. */
  let budget = 0
  const over = () =>
    (!!maxPages && maxPages >= 1 && store.pageCount > maxPages) || store.bytes > budget
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
  /** What is held beside the pages yields to those the frame keeps or reads, before any page
   *  leaves, so none is evicted that fits once it has gone: it never costs the image a page.
   *  The decoded texture levels first, the least recently read first — read again when a
   *  tile asks and they fit —, then the kept proxy, read again after a device loss. A notice says
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
  /** While this session reads through the cache, it evicts past what is held. A session another
   *  one has replaced is closing: the session in place evicts. */
  const evict = () => {
    if (!store.attached(holder)) return
    budget = store.budgetBytes
    if (!over()) return
    const held = store.heldBytes
    if (held > budget) yieldBeside(held)
    if (!store.evict(over, evicted) && over()) {
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
  }
  /** The engine's host tables take `bytes()` of the CPU share the cache holds
   *  (`../residency/memoryBudget.ts`): the decoded pages keep the rest. Read each time the cache
   *  weighs itself, for tables that follow the view. */
  const reserve = (bytes: () => number) => {
    state.reservedBytes = bytes
    evict()
  }
  /** The session's holds end with it: what it pinned or read stays cached for the next one. */
  const close = () => {
    for (const url of holding) store.release(url)
    holding.clear()
  }
  const holder = { reserved, evict }
  const { retain, retainRanks } = createStreamingPins(context, sync, evict)
  return { evict, sync, drop, close, holder, retain, retainRanks, reserve }
}
