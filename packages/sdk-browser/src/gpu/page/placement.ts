import type { ResidentPage } from './types.ts'
import type { PageHomes } from './homes.ts'
import type { Eviction, NoVictim } from './eviction.ts'

/** Where an arrival lands: its slot and first byte, and the page that gives them up, if any — it
 *  is still resident, and leaves before the arrival is written. */
export type Place = { slot: number; offset: number; victim: ResidentPage | undefined }

/** How a pool places its arrivals: the bytes a page may fill, the place it takes, and the slots no
 *  page holds. */
export interface Placement {
  /** The bytes `key`'s page may fill: one past them would write over a neighbour. */
  room(key: string): number
  /** `key`'s place, taken, or why none is. */
  slotFor(key: string): Place | NoVictim
  /** `slot` is given back by a page that left: free for the next arrival. */
  freed(slot: number): void
  /** How many slots no page holds. */
  readonly free: number
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
      return { slot: rank, offset, victim: undefined }
    },
    freed() {
      empty++
    },
    get free() {
      return empty
    },
  }
}

/** A pool of fixed slots of `pageBytes`: a `free` one, the last first, else the one `eviction`
 *  gives back. */
export function slotPlacement(pageBytes: number, free: number[], eviction: Eviction): Placement {
  return {
    room: () => pageBytes,
    slotFor() {
      const slot = free.pop()
      if (slot !== undefined) return { slot, offset: slot * pageBytes, victim: undefined }
      const victim = eviction.victim()
      if (typeof victim === 'string') return victim
      return { slot: victim.slot, offset: victim.slot * pageBytes, victim }
    },
    freed(slot) {
      free.push(slot)
    },
    get free() {
      return free.length
    },
  }
}
