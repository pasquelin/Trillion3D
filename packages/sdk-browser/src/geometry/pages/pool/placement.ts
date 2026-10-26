import type { ResidentPage } from './types.ts'
import type { PageHomes, PageUnit, PageUnitsOf } from './homes.ts'

/** Where an arrival lands: its first byte, the byte its streaming page starts at, and the pages
 *  that give up their streaming page's slot to it, if any — still resident, they leave before the
 *  arrival is written. */
export type Place = { offset: number; start: number; victims: readonly ResidentPage[] }

/** Why an arrival finds no place: none free, and no victim named whose slot it takes. */
type NoPlace = 'no-free-slot'

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

/** What the allocator keeps: the pool's layout, and the places taken and free. */
interface Pool {
  held: PageHomes | undefined
  widest: number
  units: PageUnitsOf | undefined
  rootUrls: ReadonlySet<string> | undefined
  resident: ReadonlyMap<string, ResidentPage>
  roots: RootSlots
  grain: number
  rootStart: number
  placed: Map<string, Placed>
  free: Set<number>
  freeRoots: Set<number>
}

const unitOf = (p: Pool, key: string): PageUnit => p.units?.(key) ?? { unit: key, offset: 0 }

/** Whether `key`'s streaming page takes a root grain: a root page, the pool having a root
 *  region. */
const rooted = (p: Pool, key: string) => p.roots.slots > 0 && !!p.rootUrls?.has(key)

/** Streaming page `unit` placed at `start`, in a root grain or not, `key` its first page. */
const take = (p: Pool, unit: string, start: number, root: boolean, key?: string) => {
  const at: Placed = { start, keys: new Set(key === undefined ? [] : [key]), root }
  p.placed.set(unit, at)
  return at
}

/** A root grain for streaming page `unit`, `key` its first page there; -1 for none. */
const grainFor = (p: Pool, unit: string, at: number, key?: string) =>
  at < 0 ? -1 : take(p, unit, p.rootStart + at * p.grain, true, key).start

/** The width of the place streaming page `unit` takes when no home sets it: a grain's for a
 *  root page, placed in a grain or, `key` one of its pages, not placed yet and rooted, else a
 *  slot's. */
const slotWidth = (p: Pool, unit: string, key?: string) =>
  (p.placed.get(unit)?.root ?? (key !== undefined && rooted(p, key))) ? p.grain : p.widest

const placeKey = (p: Pool, key: string, victim?: ResidentPage): Place | NoPlace => {
  const { unit, offset } = unitOf(p, key)
  const own = p.placed.get(unit)
  if (own) {
    own.keys.add(key)
    return { offset: own.start + offset, start: own.start, victims: [] }
  }
  if (p.held) {
    const home = p.held.homes.get(unit)
    if (!home) throw new Error('PAGE_HOME_MISSING')
    const { start } = take(p, unit, home.offset, false, key)
    return { offset: start + offset, start, victims: [] }
  }
  if (rooted(p, key)) {
    const start = grainFor(p, unit, takeFirst(p.freeRoots), key)
    return start < 0 ? 'no-free-slot' : { offset: start + offset, start, victims: [] }
  }
  const givenUnit = victim && unitOf(p, victim.key).unit,
    given = givenUnit === undefined ? undefined : p.placed.get(givenUnit)
  if (givenUnit !== undefined && given && !given.root) {
    p.placed.delete(givenUnit)
    const victims = [...given.keys].flatMap((page) => p.resident.get(page) ?? [])
    const { start } = take(p, unit, given.start, false, key)
    return { offset: start + offset, start, victims }
  }
  const slot = takeFirst(p.free)
  if (slot < 0) return 'no-free-slot'
  const { start } = take(p, unit, slot * p.widest, false, key)
  return { offset: start + offset, start, victims: [] }
}

const keepUnit = (p: Pool, unit: string, start: number, key: string) => {
  if (p.held) {
    const home = p.held.homes.get(unit)
    return home ? take(p, unit, home.offset, false).start : -1
  }
  if (rooted(p, key)) {
    const at = (start - p.rootStart) / p.grain
    const same = start >= p.rootStart && Number.isInteger(at) && p.freeRoots.delete(at)
    return grainFor(p, unit, same ? at : takeFirst(p.freeRoots))
  }
  const at = start / p.widest,
    same = start < p.rootStart && Number.isInteger(at) && p.free.delete(at)
  const slot = same ? at : takeFirst(p.free)
  if (slot < 0) return -1
  return take(p, unit, slot * p.widest, false).start
}

const freePage = (p: Pool, page: ResidentPage) => {
  const { unit } = unitOf(p, page.key)
  const at = p.placed.get(unit)
  if (!at?.keys.delete(page.key) || at.keys.size) return
  p.placed.delete(unit)
  if (p.held) return
  if (at.root) p.freeRoots.add((at.start - p.rootStart) / p.grain)
  else p.free.add(at.start / p.widest)
}

/** What the allocator tells without moving anything. */
function placementQueries(p: Pool, homes: PageHomes | undefined) {
  return {
    /** The bytes `key`'s page may fill from its place: one past them would write over a neighbour
     *  or the next streaming page. The catalogue's own bytes of its streaming page bound it
     *  whenever it names them, the pool holding the catalogue or not; else the place's width. */
    room(key: string) {
      const { unit, offset } = unitOf(p, key)
      return (homes?.homes.get(unit)?.bytes ?? slotWidth(p, unit, key)) - offset
    },
    /** The byte `key`'s streaming page starts at in the pool, none while it holds no place: where
     *  the clusters a page names vertices of are found (`../install/installer.ts`). */
    startOf: (key: string) => p.placed.get(unitOf(p, key).unit)?.start,
    /** Whether pages `a` and `b` are pages of one streaming page. */
    sameUnit: (a: string, b: string) => unitOf(p, a).unit === unitOf(p, b).unit,
    /** Whether `key`'s streaming page holds a place: its page lands there, no other needed. */
    holds: (key: string) => p.placed.has(unitOf(p, key).unit),
    /** Whether `key`'s streaming page takes a root grain, never a streaming slot. */
    rooted: (key: string) => rooted(p, key),
    /** Each streaming page placed, by name: its first byte, its pages, and whether a root grain
     *  holds it. */
    placed: p.placed as ReadonlyMap<string, Readonly<Placed>>,
    /** The width streaming page `unit` takes: its home's while the pool holds the catalogue, else a
     *  grain's or a slot's. */
    widthOf: (unit: string) => p.held?.homes.get(unit)?.bytes ?? slotWidth(p, unit),
    /** How many streaming pages of `key`'s kind may still take a place with no victim: the homes
     *  empty while the pool holds the catalogue, else the free root grains for a root page
     *  (`rooted`), the free streaming slots for another or for none named. */
    freeFor(key?: string) {
      if (p.held) return p.held.homes.size - p.placed.size
      return key !== undefined && rooted(p, key) ? p.freeRoots.size : p.free.size
    },
  }
}

/** What the allocator moves: places taken, kept and given up. */
function placementMoves(p: Pool) {
  return {
    /**
     * The place of `key`'s page, taken, or why none is: in its streaming page's place when it holds
     * one; else at its home while the pool holds the catalogue; else, for a root page, in a free
     * root grain; else in the slot of `victim`, a page the host gives up for it (`load.ts`),
     * its whole streaming page leaving; else in a free slot.
     */
    place: (key: string, victim?: ResidentPage): Place | NoPlace => placeKey(p, key, victim),
    /** A resize's place for streaming page `unit`, which lay at `start` (`resize.ts`), `key` one
     *  of its pages: its home while the pool holds the catalogue, else that slot — a root grain
     *  for a root page (`rooted`) — when it is free, else a free one; -1 when none is. Never a
     *  victim. Its pages join it as they keep their place (`hold`). */
    keep: (unit: string, start: number, key: string) => keepUnit(p, unit, start, key),
    /** Page `key` keeps its place in its streaming page, which `keep` placed. */
    hold(key: string) {
      p.placed.get(unitOf(p, key).unit)?.keys.add(key)
    },
    /** `page` left without an arrival to take its place: its streaming page's slot or grain is free
     *  for the next one with its last page. */
    freed: (page: ResidentPage) => freePage(p, page),
  }
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
  /** The streaming slots and the root grains no streaming page holds, in insertion order: the
   *  lowest first at the open, each one freed later (`freed`) after those. */
  const free = new Set<number>(),
    freeRoots = new Set<number>()
  if (!held) {
    for (let slot = 0; slot < Math.floor(rootStart / widest); slot++) free.add(slot)
    for (let at = 0; at < roots.slots; at++) freeRoots.add(at)
  }
  const p: Pool = {
    held,
    widest,
    units,
    rootUrls,
    resident,
    roots,
    grain,
    rootStart,
    placed: new Map<string, Placed>(),
    free,
    freeRoots,
  }
  return {
    ...placementQueries(p, homes),
    ...placementMoves(p),
    /** The root grains no streaming page holds: none while the pool holds the catalogue. */
    get rootFree() {
      return p.freeRoots.size
    },
  }
}

export type Placement = ReturnType<typeof createPlacement>
