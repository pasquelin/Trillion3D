import type { ResidentPage } from './types.ts'
import type { PageHomes } from './homes.ts'
import type { Eviction, NoVictim } from './eviction.ts'

/** Where an arrival lands: its slot and first byte, and the pages that give them up, if any — they
 *  are still resident, and leave before the arrival is written. */
export type Place = { slot: number; offset: number; victims: readonly ResidentPage[] }

/** How a pool places its arrivals: the bytes a page may fill, the place it takes, and the slots no
 *  page holds. */
export interface Placement {
  /** The bytes `key`'s page may fill: one past them would write over a neighbour. */
  room(key: string): number
  /** The place of `key`'s page of `bytes`, taken, or why none is. */
  slotFor(key: string, bytes: number): Place | NoVictim
  /** `page` left without an arrival to take its place: free for the next one. */
  freed(page: ResidentPage): void
  /** How many places no page holds: slots, and quarters of the slots split. */
  readonly free: number
  /** Each slot split in quarters, by the keys of the pages its quarters hold; none where a page
   *  fills its slot or its home. */
  readonly split: ReadonlyMap<number, ReadonlySet<string>>
}

/** `homes`' page at `key`; a key the catalogue does not name has no place there, and is refused
 *  by name. */
function homeOf({ homes }: PageHomes, key: string) {
  const home = homes.get(key)
  if (!home) throw new Error('PAGE_HOME_MISSING')
  return home
}

/** A pool that holds the whole catalogue: each page at its own home (`homes.ts`), no slot to
 *  choose, none to take back; it counts the `empty` homes, nothing more. */
export function homePlacement(homes: PageHomes, empty: number): Placement {
  return {
    room: (key) => homeOf(homes, key).bytes,
    slotFor(key) {
      const { rank, offset } = homeOf(homes, key)
      empty--
      return { slot: rank, offset, victims: [] }
    },
    freed() {
      empty++
    },
    get free() {
      return empty
    },
    split: new Map(),
  }
}

/**
 * A slot of the scene's largest cluster holds a page that fits a quarter of it four to the slot —
 * the world's super-roots, eight hundred bytes in a slot of four thousand, are held four times as
 * many in the same bytes. A quarter lies at its slot's offset plus its rank's share; the page table
 * names every page by its offset alone, so nothing that reads a page knows which it took. A slot is
 * free, held whole, or split, and a split slot is free again once its last quarter leaves. A pool
 * whose slot does not divide into four whole words splits none.
 */
export const SLOT_SPLIT = 4

/** The bytes of a quarter of a slot of `pageBytes`, or 0 when a slot does not split. */
export const quarterBytesOf = (pageBytes: number) =>
  pageBytes % (4 * SLOT_SPLIT) === 0 ? pageBytes / SLOT_SPLIT : 0

/** What a pool of fixed slots has free and split: the slots no page holds, the free quarters of
 *  the split slots, each `slot · SLOT_SPLIT + quarter`, and each split slot's pages by key. */
export type SlotLayout = {
  free: number[]
  quarters: Set<number>
  split: Map<number, Set<string>>
}

/** A layout of `free` slots, none split. */
export const wholeSlots = (free: number[]): SlotLayout => ({
  free,
  quarters: new Set(),
  split: new Map(),
})

/** A pool of fixed slots of `pageBytes` laid out as `layout`: a free place, the last first, else
 *  the one `eviction` gives back — a quarter from any unpinned page, a whole slot from a whole
 *  page or a split slot none of whose pages is pinned. */
export function slotPlacement(
  pageBytes: number,
  { free, quarters, split }: SlotLayout,
  eviction: Eviction,
  resident: ReadonlyMap<string, ResidentPage>,
  pins: ReadonlySet<string>,
): Placement {
  const quarterBytes = quarterBytesOf(pageBytes)
  const quarterOf = (page: ResidentPage) =>
    split.get(page.slot)?.has(page.key) ? (page.offset - page.slot * pageBytes) / quarterBytes : -1
  /** `page`'s place given back: a whole slot to the free ones, a quarter to the free quarters —
   *  its slot whole and free again once it holds none. */
  const release = (page: ResidentPage) => {
    const quarter = quarterOf(page)
    if (quarter < 0) return void free.push(page.slot)
    const held = split.get(page.slot)!
    held.delete(page.key)
    quarters.add(page.slot * SLOT_SPLIT + quarter)
    if (held.size > 0) return
    for (let at = 0; at < SLOT_SPLIT; at++) quarters.delete(page.slot * SLOT_SPLIT + at)
    split.delete(page.slot)
    free.push(page.slot)
  }
  /** A free quarter, taken: a free one, else one of a free slot split. */
  const takeQuarter = () => {
    for (const at of quarters) {
      quarters.delete(at)
      return at
    }
    const slot = free.pop()
    if (slot === undefined) return undefined
    split.set(slot, new Set())
    for (let quarter = 1; quarter < SLOT_SPLIT; quarter++) quarters.add(slot * SLOT_SPLIT + quarter)
    return slot * SLOT_SPLIT
  }
  /** Whether every page of split `slot` may leave: none pinned. */
  const unpinned = (slot: number) => {
    for (const key of split.get(slot) ?? []) if (pins.has(key)) return false
    return true
  }
  /** A place of `quarter` size, taken; `victims` already gone from the layout. */
  const take = (key: string, quarter: boolean, victims: ResidentPage[]): Place | undefined => {
    if (!quarter) {
      const slot = free.pop()
      return slot === undefined ? undefined : { slot, offset: slot * pageBytes, victims }
    }
    const at = takeQuarter()
    if (at === undefined) return undefined
    const slot = Math.floor(at / SLOT_SPLIT)
    split.get(slot)!.add(key)
    return { slot, offset: slot * pageBytes + (at % SLOT_SPLIT) * quarterBytes, victims }
  }
  return {
    room: () => pageBytes,
    slotFor(key, bytes) {
      const quarter = quarterBytes > 0 && bytes <= quarterBytes
      const place = take(key, quarter, [])
      if (place) return place
      const page = eviction.victim(
        (candidate) => quarter || quarterOf(candidate) < 0 || unpinned(candidate.slot),
      )
      if (typeof page === 'string') return page
      // A whole slot asked of a split one leaves with every page of it; any other victim alone.
      const victims =
        quarter || quarterOf(page) < 0
          ? [page]
          : [...split.get(page.slot)!].map((held) => resident.get(held)!)
      for (const victim of victims) release(victim)
      return take(key, quarter, victims)!
    },
    freed: release,
    get free() {
      return free.length + quarters.size
    },
    split,
  }
}
