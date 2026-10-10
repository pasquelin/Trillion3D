import type { ResidentPage } from './types.ts'
import { createCacheEntries } from '../../streaming/cacheEntries.ts'

/** An eviction order a GPU cut publishes (`../dag/evict.ts`), its keys read one at a time as
 *  victims are taken. */
export type EvictionOrder = {
  /** How many keys the order lists. */
  readonly count: number
  /** The key at rank `at`, the first victim at 0. */
  keyAt(at: number): string
}

/** Whether a page may give its place to the arrival asking. */
export type Accept = (page: ResidentPage) => boolean

/** Why no slot is given back: every page pinned, or the published order spent. */
export type NoVictim = 'all-pages-pinned' | 'eviction-queue-spent'

/**
 * Which unpinned page an arrival takes the slot of, in a pool of fixed slots. Its pages' recency is
 * the host caches' one heap (`streaming/cacheEntries.ts`): a page is an entry, its pin a hold, so
 * the heap holds only the unpinned pages, the least recently loaded or touched on top. Before any
 * order, the victim is that top, in O(log n) whatever is pinned. Once a GPU cut published an
 * order: its next resident, unpinned page the arrival may take, each entry passed once — one pinned
 * or refused when passed waits in `held` for its unpin; one a lower tier touched since the last order (`touched`) goes in
 * `late`, taken after every other —, never a page it leaves out.
 */
export function createEviction(resident: ReadonlyMap<string, ResidentPage>) {
  const recent = createCacheEntries<ResidentPage>()
  /** The pages `leastRecent` holds aside while it looks: held for that, pinned by no one. */
  const aside = new Set<string>()
  const isPinned = (key: string) => !aside.has(key) && (recent.entry(key)?.holds ?? 0) > 0
  /** The order each page a lower tier touched was touched under. */
  const lower = new Map<string, number>()
  let epoch = 0
  /** The unpinned resident page `key` when `accept` takes it. */
  const free = (key: string, accept: Accept) => {
    const page = isPinned(key) ? undefined : resident.get(key)
    return page && accept(page) ? page : undefined
  }

  /** The heap's top that `accept` takes, or why none is. It stays in the heap, for the eviction of
   *  its page to drop; each the heap offered before it that `accept` refused is held aside, and put
   *  back at its last touch's place. */
  const leastRecent = (accept: Accept): ResidentPage | NoVictim => {
    let page: ResidentPage | undefined
    for (page = recent.first?.value; page && !accept(page); page = recent.first?.value) {
      aside.add(page.key)
      recent.acquire(page.key)
    }
    for (const key of aside) recent.release(key)
    aside.clear()
    return page ?? 'all-pages-pinned'
  }

  const inOrder = (order: EvictionOrder): ((accept: Accept) => ResidentPage | NoVictim) => {
    const held: string[] = [],
      late: string[] = []
    let at = 0,
      lateAt = 0
    return (accept) => {
      while (at < order.count) {
        const key = order.keyAt(at++)
        const page = resident.get(key)
        if (!page) continue
        if ((lower.get(key) ?? -2) >= epoch - 1) late.push(key)
        else if (isPinned(key) || !accept(page)) held.push(key)
        else return page
      }
      for (const key of held) {
        const page = free(key, accept)
        if (page) return page
      }
      while (lateAt < late.length) {
        const page = free(late[lateAt++], accept)
        if (page) return page
      }
      return 'eviction-queue-spent'
    }
  }

  let strategy: (accept: Accept) => ResidentPage | NoVictim = leastRecent
  return {
    /** The page whose place the next arrival takes among those `accept` takes, or why none is. */
    victim: (accept: Accept = () => true) => strategy(accept),
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
    /** `key`'s page is pinned, one hold of the heap's: no eviction takes it until its unpin. False
     *  when it already was. */
    pin(key: string) {
      if (isPinned(key)) return false
      recent.acquire(key)
      return true
    },
    /** `key`'s page is unpinned, back at its last touch's place. False when it was not pinned. */
    unpin(key: string) {
      if (!isPinned(key)) return false
      recent.release(key)
      return true
    },
    isPinned,
    /** How many pages are pinned: the entries the heap does not hold. */
    get pinnedCount() {
      return recent.heldCount
    },
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
