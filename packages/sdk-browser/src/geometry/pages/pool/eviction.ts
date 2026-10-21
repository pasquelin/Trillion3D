import type { ResidentPage } from './types.ts'

/** An eviction order a GPU pool publishes (`../../../gpu/sort/sortWgsl.ts`), its keys read one at a
 *  time as victims are taken: a place for tiles, a row for rows. */
export type EvictionOrder<K = string> = {
  /** How many keys the order lists. */
  readonly count: number
  /** The key at rank `at`, the first victim at 0. */
  keyAt(at: number): K
  /** The pool's arrivals when its cut ran: a key taken again since is not in it, whatever it is. */
  readonly arrivals: number
}

/** What a pool holds of each resident key: the arrival count when it arrived. */
type Held = { readonly generation: number }

/** Whether a page may give its place to the arrival asking. */
export type Accept<V extends Held = ResidentPage> = (page: V) => boolean

/** Why no slot is given back: no order, or the order spent. */
export type NoVictim = 'eviction-queue-spent'

/**
 * Which resident key an arrival takes the place of: the next key of the order the pool's GPU sort
 * published (`../../../gpu/sort/sortWgsl.ts`), which alone knows when each was last used by any
 * view. Each entry is passed once; one pinned or refused when passed waits in `held` for its unpin,
 * and is offered before the entries after it. A key taken again after the order's cut is never its
 * victim, nor one it does not list. Before any order there is no victim: the arrival waits for the
 * next readback. The victim taker of the tile pools and the row table (`../../../gpu/sort/slotOrder.ts`),
 * keyed `K`, each resident key's entry `V`.
 *
 * A pin is the pool's own hold. The geometry pool holds its pins here alone: its victims are the
 * host's, the oldest of the residency's use order (`../../residency/streamedPages.ts`), named to each
 * load (`load.ts`).
 */
export function createEviction<K = string, V extends Held = ResidentPage>(
  resident: Pick<ReadonlyMap<K, V>, 'get'>,
) {
  const pins = new Set<K>()
  let order: EvictionOrder<K> | undefined,
    at = 0
  /** The rank of each key the order lists, and its keys by rank, read once when first asked:
   *  victims alone read no more than they take. */
  const ranks = new Map<K, number>(),
    keys: K[] = []
  let mapped = false
  const rankOf = (key: K) => {
    if (!mapped && order) {
      mapped = true
      for (let rank = 0; rank < order.count; rank++)
        ranks.set((keys[rank] = order.keyAt(rank)), rank)
    }
    return ranks.get(key)
  }
  const keyAt = (rank: number) => (mapped ? keys[rank] : order!.keyAt(rank))
  /** Entries passed while pinned or refused, with their rank: offered again, first. */
  const held: { key: K; rank: number }[] = []
  /** The listed page `key` when it may give its place: still resident, not arrived since, not
   *  pinned, accepted. `undefined` keeps it held; `null` drops it for good. */
  const listed = (key: K, accept: Accept<V>) => {
    const page = resident.get(key)
    if (!page || page.generation > order!.arrivals) return null
    return pins.has(key) || !accept(page) ? undefined : page
  }
  return {
    /** The page whose place the next arrival takes among those `accept` takes, or why none is. */
    victim(accept: Accept<V> = () => true): V | NoVictim {
      if (!order) return 'eviction-queue-spent'
      for (let i = 0; i < held.length; i++) {
        const page = listed(held[i].key, accept)
        if (page === undefined) continue
        held.splice(i--, 1)
        if (page) return page
      }
      while (at < order.count) {
        const rank = at++,
          key = keyAt(rank),
          page = listed(key, accept)
        if (page) return page
        if (page === undefined) held.push({ key, rank })
      }
      return 'eviction-queue-spent'
    },
    /** How many victims the order may still give an arrival: an upper bound, read before a page
     *  is read for nothing. */
    victims() {
      if (!order) return 0
      return Math.max(0, order.count - at) + held.length
    },
    /** `key`'s rank in the order, the first victim at 0; `undefined` for a key it does not list. */
    rankOf,
    /** Evicts in `order` from now on; `undefined`: no victim until the next one. */
    follow(next?: EvictionOrder<K>) {
      order = next
      at = 0
      held.length = 0
      ranks.clear()
      keys.length = 0
      mapped = false
    },
    /** `key`'s page is pinned: no eviction takes it until its unpin. False when it already was. */
    pin(key: K) {
      if (pins.has(key)) return false
      pins.add(key)
      return true
    },
    /** `key`'s page is unpinned. False when it was not pinned. */
    unpin: (key: K) => pins.delete(key),
    isPinned: (key: K) => pins.has(key),
    /** How many pages are pinned. */
    get pinnedCount() {
      return pins.size
    },
    /** `key` left the pool, its pin with it. */
    left(key: K) {
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

export type Eviction<K = string, V extends Held = ResidentPage> = ReturnType<
  typeof createEviction<K, V>
>
