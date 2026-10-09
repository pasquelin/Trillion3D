import type { ResidentPage } from './types.ts'
import type { PageHomes } from './homes.ts'
import type { Eviction, NoVictim } from './eviction.ts'

/** Where an arrival lands: its slot and first byte, and the page that gives them up, if any — it
 *  is still resident, and leaves before the arrival is written. */
export type Place = { slot: number; offset: number; victim: ResidentPage | undefined }

/** How a pool places its arrivals: the bytes a page may fill, and the place it takes. */
export interface Placement {
  /** The bytes `key`'s page may fill: one past them would write over a neighbour. */
  room(key: string): number
  /** `key`'s place, taken, or why none is. */
  slotFor(key: string): Place | NoVictim
}

/** `homes`' page at `key`; a key the catalogue does not name has no place there, and is refused
 *  by name. */
function homeOf({ homes }: PageHomes, key: string) {
  const home = homes.get(key)
  if (!home) throw new Error('PAGE_HOME_MISSING')
  return home
}

/** A pool that holds the whole catalogue: each page at its own home (`homes.ts`), no slot to
 *  choose, none to take back; `free` counts the homes still empty. */
const homePlacement = (homes: PageHomes, free: number[]): Placement => ({
  room: (key) => homeOf(homes, key).bytes,
  slotFor(key) {
    const { rank, offset } = homeOf(homes, key)
    free.pop()
    return { slot: rank, offset, victim: undefined }
  },
})

/** A pool of fixed slots of `pageBytes`: a free one, else the one `eviction` gives back. */
const slotPlacement = (pageBytes: number, free: number[], eviction: Eviction): Placement => ({
  room: () => pageBytes,
  slotFor() {
    const slot = free.pop()
    if (slot !== undefined) return { slot, offset: slot * pageBytes, victim: undefined }
    const victim = eviction.victim()
    if (typeof victim === 'string') return victim
    return { slot: victim.slot, offset: victim.slot * pageBytes, victim }
  },
})

/** The placement of a pool whose `homes` are those it holds (`heldHomes`): theirs, else fixed
 *  slots. */
export const placementOf = (
  homes: PageHomes | undefined,
  pageBytes: number,
  free: number[],
  eviction: Eviction,
): Placement => (homes ? homePlacement(homes, free) : slotPlacement(pageBytes, free, eviction))
