import type { ResidentPage } from './types.ts'
import { createCacheEntries } from '../../streaming/cacheEntries.ts'

/** An eviction order a GPU cut publishes (`../dag/evict.ts`), its keys read one at a time as
 *  victims are taken. */
export type EvictionOrder = { readonly count: number; keyAt(at: number): string }

/** Why no slot is given back: every page pinned, or the published order spent. */
export type NoVictim = 'all-pages-pinned' | 'eviction-queue-spent'

/**
 * Which unpinned page an arrival takes the slot of, in a pool of fixed slots. Its pages' recency is
 * the host caches' one heap (`streaming/cacheEntries.ts`): a page is an entry, its pin a hold, so
 * the heap holds only the unpinned pages, the least recently loaded or touched on top. Before any
 * order, the victim is that top, in O(log n) whatever is pinned. Once a GPU cut published an
 * order: its next resident, unpinned page, each entry passed once — one pinned when passed waits
 * in `held` for its unpin; one a lower tier touched since the last order (`touched`) goes in
 * `late`, taken after every other —, never a page it leaves out.
 */
export function createEviction(
  resident: ReadonlyMap<string, ResidentPage>,
  pins: ReadonlySet<string>,
) {
  const recent = createCacheEntries<ResidentPage>()
  /** The order each page a lower tier touched was touched under. */
  const lower = new Map<string, number>()
  let epoch = 0
  const unpinned = (key: string) => (pins.has(key) ? undefined : resident.get(key))

  /** The heap's top, taken out by `evict`: one entry, the first it is offered. */
  const taken: { page?: ResidentPage } = {}
  const first = () => taken.page === undefined
  const take = (_: string, page: ResidentPage) => (taken.page = page)
  const leastRecent = (): ResidentPage | NoVictim => {
    recent.evict(first, take)
    const { page } = taken
    taken.page = undefined
    return page ?? 'all-pages-pinned'
  }

  const inOrder = (order: EvictionOrder): (() => ResidentPage | NoVictim) => {
    const held: string[] = [],
      late: string[] = []
    let at = 0,
      lateAt = 0
    return () => {
      while (at < order.count) {
        const key = order.keyAt(at++)
        const page = resident.get(key)
        if (!page) continue
        if ((lower.get(key) ?? -2) >= epoch - 1) late.push(key)
        else if (pins.has(key)) held.push(key)
        else return page
      }
      for (const key of held) {
        const page = unpinned(key)
        if (page) return page
      }
      while (lateAt < late.length) {
        const page = unpinned(late[lateAt++])
        if (page) return page
      }
      return 'eviction-queue-spent'
    }
  }

  let strategy = leastRecent
  return {
    /** The page whose slot the next arrival takes, or why none is. */
    victim: () => strategy(),
    /** Evicts in `order` from now on; `undefined` goes back to the least recent. */
    follow(order?: EvictionOrder) {
      epoch++
      strategy = order ? inOrder(order) : leastRecent
    },
    /** `page` arrived: the most recent. */
    arrived: (page: ResidentPage) => recent.set(page.key, page, page.bytes),
    /** `key` was read or touched: the most recent; `lowerTier` when only a lower tier wants it. */
    touched(key: string, lowerTier = false) {
      recent.touch(key)
      if (lowerTier) lower.set(key, epoch)
    },
    /** `key` was pinned: no eviction takes it until its unpin. */
    pinned: (key: string) => recent.acquire(key),
    /** `key` was unpinned: back at its last touch's place. */
    unpinned: (key: string) => recent.release(key),
    /** `key` left the pool. */
    left(key: string) {
      recent.drop(key)
      lower.delete(key)
    },
    /** Every page left at once. */
    clear() {
      recent.clear()
      lower.clear()
    },
  }
}

export type Eviction = ReturnType<typeof createEviction>
