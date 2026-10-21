import type { ResidentPage } from './types.ts'
import type { PageHomes, PageUnit, PageUnitsOf } from './homes.ts'

/** Where an arrival lands: its first byte, and the pages that give up their streaming page's slot
 *  to it, if any — still resident, they leave before the arrival is written. */
export type Place = { offset: number; victims: readonly ResidentPage[] }

/** Why an arrival finds no place: none free, and no victim named whose slot it takes. */
export type NoPlace = 'no-free-slot'

/** The pool's ROOT REGION, behind its streaming slots: `slots` grains of `bytes` — the widest
 *  root page's, a compiled root page's bytes at most (`ROOT_PAGE_BYTES`,
 *  `packages/asset-compiler-rust/src/compiler/pages/bundles.rs`) —, each holding one ROOT PAGE:
 *  the root cover's, or an HLOD cell's while its actor is loaded. It grows as the cells hold more
 *  (`../../../frame/io/memory.ts`, `growWebgpuRootRegion`). */
export type RootSlots = { readonly slots: number; readonly bytes: number }
/** No root region: the root pages take streaming slots. */
export const NO_ROOT_SLOTS: RootSlots = { slots: 0, bytes: 0 }

/** The bytes a pool of `slots` slots takes — `roots.slots` of them root grains, the others
 *  streaming pages of `pageBytes` at most —: the catalogue's own bytes when they fit the slots'
 *  (`homes.ts`), the slots' otherwise. */
export const poolBytes = (
  pageBytes: number,
  slots: number,
  homes?: PageHomes,
  roots = NO_ROOT_SLOTS,
) => {
  const slotted = (slots - roots.slots) * pageBytes + roots.slots * roots.bytes
  return homes && homes.bytes <= slotted ? homes.bytes : slotted
}

/** The most pages a pool of `slots` streaming pages holds at once, each of `perSlot` pages at most
 *  (the census's `unitPages`): what the tables sized by resident page ask
 *  (`../../../frame/prepare/layout.ts`, `askedTableRows`). */
export const pagesHeld = (slots: number, perSlot: number) => slots * perSlot

/** A streaming page placed: its first byte, its pages placed there, and whether a root grain
 *  holds it. */
type Placed = { start: number; keys: Set<string>; root: boolean }

/** The first member of `free` in its insertion order, taken; -1 for none. */
function takeFirst(free: Set<number>) {
  const first = free.values().next()
  if (first.done) return -1
  free.delete(first.value)
  return first.value
}

/**
 * THE POOL'S ONE ALLOCATOR, by STREAMING PAGE (`homes.ts`, `PageUnit`: each address's page, an
 * address `units` names none of a page alone): a page lies at its streaming page's place plus its
 * offset there; the streaming page takes its place with its first page and gives it up with its
 * last, so its pages lie packed as the cache laid them, never one a slot.
 * - While the pool holds the catalogue's bytes (`poolBytes`), each streaming page takes its home at
 *   its exact width: homes partition the pool and only their pages hold them, so a home is always
 *   free for its pages — no search, no victim.
 * - Otherwise the pool is slots of the widest streaming page, each streaming page one slot
 *   whatever its bytes — the slot of the victim the host names (`load.ts`), every page of the
 *   victim's streaming page leaving with it, else a free one —, then its ROOT REGION
 *   (`RootSlots`): a ROOT PAGE (`rootUrls`) takes a free grain there, which it gives up only when
 *   it leaves; it never takes a streaming slot, nor a victim's.
 * Cost: O(1) an arrival, beside the victims it names.
 */
export function createPlacement(o: {
  bytes: number
  /** The widest streaming page: the width of every slot, and the room of one no home names. */
  widest: number
  homes?: PageHomes
  units?: PageUnitsOf
  /** The root region, behind the streaming slots: none, the root pages take streaming slots. */
  roots?: RootSlots
  /** Every root page's address — the root cover's, and each HLOD cell's while its actor is
   *  loaded —: their streaming pages take the root region's grains. */
  rootUrls?: ReadonlySet<string>
  /** The pool's pages: the victims a slot given up names. */
  resident: ReadonlyMap<string, ResidentPage>
}) {
  const { homes, widest, units, rootUrls, resident } = o
  const held = homes && o.bytes >= homes.bytes ? homes : undefined
  const roots = (!held && o.roots) || NO_ROOT_SLOTS,
    grain = roots.bytes
  /** The root region's first byte: past the streaming slots. */
  const rootStart = o.bytes - roots.slots * grain
  const unitOf = (key: string): PageUnit => units?.(key) ?? { unit: key, offset: 0 }
  /** Whether `key`'s streaming page takes a root grain: a root page, the pool having a root
   *  region. */
  const rooted = (key: string) => roots.slots > 0 && !!rootUrls?.has(key)
  const placed = new Map<string, Placed>()
  /** The streaming slots and the root grains no streaming page holds, in insertion order: the
   *  lowest first at the open, each one freed later (`freed`) after those. */
  const free = new Set<number>(),
    freeRoots = new Set<number>()
  if (!held) {
    for (let slot = 0; slot < Math.floor(rootStart / widest); slot++) free.add(slot)
    for (let at = 0; at < roots.slots; at++) freeRoots.add(at)
  }
  /** Streaming page `unit` placed at `start`, in a root grain or not, `key` its first page. */
  const take = (unit: string, start: number, root: boolean, key?: string) => {
    const at: Placed = { start, keys: new Set(key === undefined ? [] : [key]), root }
    placed.set(unit, at)
    return at
  }
  /** A root grain for streaming page `unit`, `key` its first page there; -1 for none. */
  const grainFor = (unit: string, at: number, key?: string) =>
    at < 0 ? -1 : take(unit, rootStart + at * grain, true, key).start
  /** The width of the place streaming page `unit` takes when no home sets it: a grain's for a
   *  root page, placed in a grain or, `key` one of its pages, not placed yet and rooted, else a
   *  slot's. */
  const slotWidth = (unit: string, key?: string) =>
    (placed.get(unit)?.root ?? (key !== undefined && rooted(key))) ? grain : widest
  /** The width streaming page `unit` takes: its home's while the pool holds the catalogue, else a
   *  grain's or a slot's. */
  const widthOf = (unit: string) => held?.homes.get(unit)?.bytes ?? slotWidth(unit)
  return {
    /** The bytes `key`'s page may fill from its place: one past them would write over a neighbour
     *  or the next streaming page. The catalogue's own bytes of its streaming page bound it
     *  whenever it names them, the pool holding the catalogue or not; else the place's width. */
    room(key: string) {
      const { unit, offset } = unitOf(key)
      return (homes?.homes.get(unit)?.bytes ?? slotWidth(unit, key)) - offset
    },
    /**
     * The place of `key`'s page, taken, or why none is: in its streaming page's place when it holds
     * one; else at its home while the pool holds the catalogue; else, for a root page, in a free
     * root grain; else in the slot of `victim`, a page the host gives up for it (`load.ts`),
     * its whole streaming page leaving; else in a free slot.
     */
    place(key: string, victim?: ResidentPage): Place | NoPlace {
      const { unit, offset } = unitOf(key)
      const own = placed.get(unit)
      if (own) {
        own.keys.add(key)
        return { offset: own.start + offset, victims: [] }
      }
      if (held) {
        const home = held.homes.get(unit)
        if (!home) throw new Error('PAGE_HOME_MISSING')
        return { offset: take(unit, home.offset, false, key).start + offset, victims: [] }
      }
      if (rooted(key)) {
        const start = grainFor(unit, takeFirst(freeRoots), key)
        return start < 0 ? 'no-free-slot' : { offset: start + offset, victims: [] }
      }
      const givenUnit = victim && unitOf(victim.key).unit,
        given = givenUnit === undefined ? undefined : placed.get(givenUnit)
      if (givenUnit !== undefined && given && !given.root) {
        placed.delete(givenUnit)
        const victims = [...given.keys].flatMap((page) => resident.get(page) ?? [])
        return { offset: take(unit, given.start, false, key).start + offset, victims }
      }
      const slot = takeFirst(free)
      if (slot < 0) return 'no-free-slot'
      return { offset: take(unit, slot * widest, false, key).start + offset, victims: [] }
    },
    /** A resize's place for streaming page `unit`, which lay at `start` (`resize.ts`), `key` one
     *  of its pages: its home while the pool holds the catalogue, else that slot — a root grain
     *  for a root page (`rooted`) — when it is free, else a free one; -1 when none is. Never a
     *  victim. Its pages join it as they keep their place (`hold`). */
    keep(unit: string, start: number, key: string) {
      if (held) {
        const home = held.homes.get(unit)
        return home ? take(unit, home.offset, false).start : -1
      }
      if (rooted(key)) {
        const at = (start - rootStart) / grain
        const same = start >= rootStart && Number.isInteger(at) && freeRoots.delete(at)
        return grainFor(unit, same ? at : takeFirst(freeRoots))
      }
      const at = start / widest,
        same = start < rootStart && Number.isInteger(at) && free.delete(at)
      const slot = same ? at : takeFirst(free)
      if (slot < 0) return -1
      return take(unit, slot * widest, false).start
    },
    /** Page `key` keeps its place in its streaming page, which `keep` placed. */
    hold(key: string) {
      placed.get(unitOf(key).unit)?.keys.add(key)
    },
    /** Whether `key`'s streaming page holds a place: its page lands there, no other needed. */
    holds: (key: string) => placed.has(unitOf(key).unit),
    /** Whether `key`'s streaming page takes a root grain, never a streaming slot. */
    rooted,
    /** Each streaming page placed, by name: its first byte, its pages, and whether a root grain
     *  holds it. */
    placed: placed as ReadonlyMap<string, Readonly<Placed>>,
    widthOf,
    /** `page` left without an arrival to take its place: its streaming page's slot or grain is free
     *  for the next one with its last page. */
    freed(page: ResidentPage) {
      const { unit } = unitOf(page.key)
      const at = placed.get(unit)
      if (!at?.keys.delete(page.key) || at.keys.size) return
      placed.delete(unit)
      if (held) return
      if (at.root) freeRoots.add((at.start - rootStart) / grain)
      else free.add(at.start / widest)
    },
    /** How many streaming pages of `key`'s kind may still take a place with no victim: the homes
     *  empty while the pool holds the catalogue, else the free root grains for a root page
     *  (`rooted`), the free streaming slots for another or for none named. */
    freeFor(key?: string) {
      if (held) return held.homes.size - placed.size
      return key !== undefined && rooted(key) ? freeRoots.size : free.size
    },
    /** The root grains no streaming page holds: none while the pool holds the catalogue. */
    get rootFree() {
      return freeRoots.size
    },
  }
}

export type Placement = ReturnType<typeof createPlacement>
