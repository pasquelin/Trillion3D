import type { ResidentPage } from './types.ts'

/** An eviction order a GPU cut publishes (`../dag/evict.ts`), its keys read one at a time as
 *  victims are taken. */
export type EvictionOrder = {
  /** How many keys the order lists. */
  readonly count: number
  /** The key at rank `at`, the first victim at 0. */
  keyAt(at: number): string
  /** How many of its first keys are OLD: older than any page the view ahead asks for. */
  readonly old: number
  /** The cache's arrivals when its cut ran (`arrivals`): a page that arrived since is not in it,
   *  whatever its key. */
  readonly arrivals: number
  /** False while the cut the frames draw is older than the order (`../core/selection.ts`,
   *  `cutHeld`): a page it lists may be drawn still, so none leaves. */
  open(): boolean
}

/** Whether a page may give its place to the arrival asking. */
export type Accept = (page: ResidentPage) => boolean

/** Why no slot is given back: no order, or the order spent. */
export type NoVictim = 'eviction-queue-spent'

/**
 * Which resident page an arrival takes the slot of, in a pool of fixed slots: the next page of the
 * order the GPU cut published (`../dag/evict.ts`), which alone knows when each page was last used
 * by any view, and holds a page's parents as long as the page. Each entry is passed once; one
 * pinned or refused when passed waits in `held` for its unpin, and is offered before the entries
 * after it. A page that arrived after the order's cut is never its victim, nor one it does not list.
 * Before any order, or while the frames draw a cut older than it, there is no victim: the arrival
 * waits for the next readback. `lower` — a page of a lower tier asking — takes only from the order's
 * OLD head: it never evicts a page any view used of late.
 *
 * A pin is the cache's own hold: the root cover's pages, which the GPU never lists either
 * (`../dag/poolList.ts`). No clock, no recency: the GPU's.
 */
export function createEviction(resident: ReadonlyMap<string, ResidentPage>) {
  const pins = new Set<string>()
  let order: EvictionOrder | undefined,
    at = 0
  /** The rank of each key the order lists, and its keys by rank, read once when first asked:
   *  victims alone read no more than they take. */
  const ranks = new Map<string, number>(),
    keys: string[] = []
  let mapped = false
  const rankOf = (key: string) => {
    if (!mapped && order) {
      mapped = true
      for (let rank = 0; rank < order.count; rank++)
        ranks.set((keys[rank] = order.keyAt(rank)), rank)
    }
    return ranks.get(key)
  }
  const keyAt = (rank: number) => (mapped ? keys[rank] : order!.keyAt(rank))
  /** Entries passed while pinned or refused, with their rank: offered again, first. */
  const held: { key: string; rank: number }[] = []
  /** The listed page `key` when it may give its place: still resident, not arrived since, not
   *  pinned, accepted. `undefined` keeps it held; `null` drops it for good. */
  const listed = (key: string, accept: Accept) => {
    const page = resident.get(key)
    if (!page || page.generation > order!.arrivals) return null
    return pins.has(key) || !accept(page) ? undefined : page
  }
  return {
    /** The page whose place the next arrival takes among those `accept` takes, or why none is. */
    victim(accept: Accept = () => true, lower = false): ResidentPage | NoVictim {
      if (!order?.open()) return 'eviction-queue-spent'
      const end = lower ? order.old : order.count
      for (let i = 0; i < held.length; i++) {
        if (held[i].rank >= end) continue
        const page = listed(held[i].key, accept)
        if (page === undefined) continue
        held.splice(i--, 1)
        if (page) return page
      }
      while (at < end) {
        const rank = at++,
          key = keyAt(rank),
          page = listed(key, accept)
        if (page) return page
        if (page === undefined) held.push({ key, rank })
      }
      return 'eviction-queue-spent'
    },
    /** How many victims the order may still give an arrival, `lower` or not: an upper bound, read
     *  before a page is read for nothing. */
    victims(lower = false) {
      if (!order?.open()) return 0
      return Math.max(0, (lower ? order.old : order.count) - at) + held.length
    },
    /** Whether `key`'s page may leave with a victim — the order lists it, in its old head for
     *  `lower` —: what a slot split in quarters asks of every page it holds (`placement.ts`). */
    evictable(key: string, lower = false) {
      const rank = rankOf(key)
      if (rank === undefined || !order?.open() || pins.has(key)) return false
      const page = resident.get(key)
      return !!page && page.generation <= order.arrivals && rank < (lower ? order.old : order.count)
    },
    /** `key`'s rank in the order, the first victim at 0; `undefined` for a key it does not list. */
    rankOf,
    /** Evicts in `order` from now on; `undefined`: no victim until the next one. */
    follow(next?: EvictionOrder) {
      order = next
      at = 0
      held.length = 0
      ranks.clear()
      keys.length = 0
      mapped = false
    },
    /** `key`'s page is pinned: no eviction takes it until its unpin. False when it already was. */
    pin(key: string) {
      if (pins.has(key)) return false
      pins.add(key)
      return true
    },
    /** `key`'s page is unpinned. False when it was not pinned. */
    unpin: (key: string) => pins.delete(key),
    isPinned: (key: string) => pins.has(key),
    /** How many pages are pinned. */
    get pinnedCount() {
      return pins.size
    },
    /** `key` left the pool, its pin with it. */
    left(key: string) {
      pins.delete(key)
    },
    /** Every page left at once. */
    clear() {
      pins.clear()
      order = undefined
      held.length = 0
      ranks.clear()
      keys.length = 0
      mapped = false
    },
  }
}

export type Eviction = ReturnType<typeof createEviction>
