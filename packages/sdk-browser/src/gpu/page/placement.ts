import { alignDown, alignUp, ceilDiv, floorLog2 } from '../../../../math/src/scalar/integers.ts'
import type { ResidentPage } from './types.ts'
import { lastAtMost } from '../../../../math/src/scalar/search.ts'
import type { PageHomes } from './homes.ts'
import type { Eviction, NoVictim } from './eviction.ts'

/** Where an arrival lands: its first byte, and the pages that give it up, if any — they are still
 *  resident, and leave before the arrival is written. */
export type Place = { offset: number; victims: readonly ResidentPage[] }

/** The bytes a pool of `slots` pages of `pageBytes` at most takes: the catalogue's own bytes when
 *  they fit the slots' (`homes.ts`), the slots' otherwise. */
export const poolBytes = (pageBytes: number, slots: number, homes?: PageHomes) =>
  homes && homes.bytes <= pageBytes * slots ? homes.bytes : pageBytes * slots

/** The grain a page of `bytes` takes in a pool whose widest page is `widest`: the widest halved
 *  while whole words still hold the page (`createPlacement`). */
function grainOf(widest: number, bytes: number) {
  let grain = widest
  while (grain % 8 === 0 && grain / 2 >= bytes) grain /= 2
  return Math.max(grain, alignUp(bytes, 4))
}

/**
 * The most pages a pool of `slots` slots of `widest` bytes holds at once (`createPlacement`): the
 * whole catalogue where it holds its bytes (`poolBytes`), else its narrowest pages first, each at
 * its grain — more than `slots` where pages are narrower than the widest. What the tables sized by
 * resident page ask (`../../webgpu/pages/prepare/layout.ts`, `askedTableRows`). O(pages) once, the
 * grains being the widest's halvings.
 */
export function pagesHeld(widest: number, slots: number, homes?: PageHomes) {
  const bytes = widest * slots
  if (!homes) return slots
  if (homes.bytes <= bytes) return homes.homes.size
  const count = new Map<number, number>()
  for (const home of homes.homes.values()) {
    const grain = grainOf(widest, home.bytes)
    count.set(grain, (count.get(grain) ?? 0) + 1)
  }
  let room = bytes,
    pages = 0
  for (const grain of [...count.keys()].sort((a, b) => a - b)) {
    const fit = Math.min(count.get(grain)!, Math.floor(room / grain))
    pages += fit
    room -= fit * grain
  }
  return pages
}

/** A free span's size class: spans of `[4·2^c, 4·2^(c+1))` bytes in class `c`. */
const classOf = (bytes: number) => floorLog2(Math.max(1, bytes >>> 2))

/**
 * THE POOL'S ONE ALLOCATOR: byte spans of the pool buffer, held in an array sorted by offset, free
 * or held, the free ones filed by size class. A page's width is its home's (`homes.ts`: its bytes
 * and its deformation tails) when the catalogue names it, its bytes padded to a word otherwise.
 * - While the pool holds the catalogue's bytes (`poolBytes`), a page takes its home at its exact
 *   width: homes partition the pool and only their pages hold them, so a home is always free for
 *   its page — no search, no victim.
 * - Otherwise its width rounds up to a grain, the widest page halved while it stays whole words and
 *   holds the page (`grainOf`), aligned to itself: the first free span of its class or above that
 *   holds an aligned grain is split (segregated fit); else the eviction order (`eviction.ts`) gives
 *   its first victim whose aligned grain holds only free or evictable spans, and they leave with it.
 * A freed span joins its free neighbours. Fixed slots are its equal-width case — every page the
 * widest, every grain one slot, every window one victim —; a page a quarter of the widest takes a
 * quarter, a half a half, and a grain never straddles a wider one, so a widest arrival frees the
 * aligned grain of the small pages the order gives up. Cost: an arrival a binary search per free
 * span it looks at and O(n) word moves to split one (n the spans, twice the pages at most); a
 * window O(spans in one grain) beside the order's walk.
 */
export function createPlacement(o: {
  bytes: number
  /** The widest page: the room of one the catalogue does not name, and the largest grain. */
  widest: number
  homes?: PageHomes
  eviction: Eviction
  resident: ReadonlyMap<string, ResidentPage>
}) {
  const { eviction, resident, homes, widest } = o
  const held = homes && o.bytes >= homes.bytes ? homes : undefined
  const starts: number[] = [0],
    sizes: number[] = [o.bytes],
    keys: (string | null)[] = [null],
    buckets: Set<number>[] = []
  let freeBytes = 0,
    count = 0
  const bucket = (bytes: number) => (buckets[classOf(bytes)] ??= new Set())
  const refree = (i: number) => (bucket(sizes[i]).add(starts[i]), (freeBytes += sizes[i]))
  const unfree = (i: number) => (bucket(sizes[i]).delete(starts[i]), (freeBytes -= sizes[i]))
  refree(0)
  /** The span holding byte `offset`. */
  const indexOf = (offset: number) => lastAtMost(starts, offset)
  /** Free span `i` gives `[offset, offset + width)` to `key`; what lies before and after stays free. */
  const carve = (i: number, offset: number, width: number, key: string) => {
    const start = starts[i],
      end = start + sizes[i]
    unfree(i)
    const at = offset > start ? [start, offset] : [offset],
      size = offset > start ? [offset - start, width] : [width],
      owner: (string | null)[] = offset > start ? [null, key] : [key]
    if (offset + width < end) {
      at.push(offset + width)
      size.push(end - offset - width)
      owner.push(null)
    }
    starts.splice(i, 1, ...at)
    sizes.splice(i, 1, ...size)
    keys.splice(i, 1, ...owner)
    for (let k = 0; k < owner.length; k++) if (owner[k] === null) refree(i + k)
    count++
  }
  /** Held span `i` free again, joined to its free neighbours. */
  const release = (i: number) => {
    let first = i,
      last = i
    if (i > 0 && keys[i - 1] === null) unfree((first = i - 1))
    if (i + 1 < keys.length && keys[i + 1] === null) unfree((last = i + 1))
    const size = starts[last] + sizes[last] - starts[first]
    starts.splice(first, last - first + 1, starts[first])
    sizes.splice(first, last - first + 1, size)
    keys.splice(first, last - first + 1, null)
    refree(first)
    count--
  }
  /** The first free span holding `width` bytes at an offset aligned to `width`: its index and that
   *  offset, or none. */
  const fit = (width: number) => {
    for (let c = classOf(width); c < buckets.length; c++)
      for (const start of buckets[c] ?? []) {
        const i = indexOf(start),
          at = alignUp(start, width)
        if (at + width <= start + sizes[i]) return { i, at }
      }
    return undefined
  }
  /** The grain `[at, at + width)` holding `page`, the order's victim, when every other span it
   *  meets is free or evictable: a grain of the victim alone asks the order nothing more. */
  const windowAt = (page: ResidentPage, width: number, lower?: boolean) => {
    const at = alignDown(page.offset, width)
    if (at + width > o.bytes) return undefined
    for (let j = indexOf(at); j < keys.length && starts[j] < at + width; j++)
      if (keys[j] !== null && keys[j] !== page.key && !eviction.evictable(keys[j]!, lower))
        return undefined
    return at
  }
  /** The bytes `key`'s page of `bytes` takes: its home's width while the pool holds the catalogue,
   *  else its grain (`grainOf`). */
  const widthFor = (key: string, bytes: number) => {
    const own = homes?.homes.get(key)?.bytes ?? alignUp(bytes, 4)
    return held ? own : grainOf(widest, own)
  }
  return {
    /** The bytes `key`'s page may fill: one past them would write over a neighbour. */
    room: (key: string) => homes?.homes.get(key)?.bytes ?? widest,
    /** The place of `key`'s page of `bytes`, taken, or why none is; `lower`, a page of a lower
     *  tier, takes an old page's alone (`eviction.ts`). */
    place(key: string, bytes: number, lower?: boolean): Place | NoVictim {
      const width = widthFor(key, bytes)
      if (held) {
        const home = held.homes.get(key)
        if (!home) throw new Error('PAGE_HOME_MISSING')
        const i = indexOf(home.offset)
        if (keys[i] !== null) return 'eviction-queue-spent'
        carve(i, home.offset, width, key)
        return { offset: home.offset, victims: [] }
      }
      const free = fit(width)
      if (free) {
        carve(free.i, free.at, width, key)
        return { offset: free.at, victims: [] }
      }
      const page = eviction.victim(
        (candidate) => windowAt(candidate, width, lower) !== undefined,
        lower,
      )
      if (typeof page === 'string') return page
      const at = windowAt(page, width, lower)!,
        victims: ResidentPage[] = []
      for (let j = indexOf(at); j < keys.length && starts[j] < at + width; j++)
        if (keys[j] !== null) victims.push(resident.get(keys[j]!)!)
      for (const victim of victims) release(indexOf(victim.offset))
      carve(indexOf(at), at, width, key)
      return { offset: at, victims }
    },
    /** A resize's place for `key`'s page of `width` (`widthFor`): its home while the pool holds the
     *  catalogue, else `offset` when that grain is free, else the first free grain; -1 when none
     *  is. Never a victim. */
    keep(key: string, width: number, offset: number) {
      const at = held ? held.homes.get(key)?.offset : offset % width === 0 ? offset : -1
      if (at !== undefined && at >= 0 && at + width <= o.bytes) {
        const i = indexOf(at)
        if (keys[i] === null && starts[i] + sizes[i] >= at + width) {
          carve(i, at, width, key)
          return at
        }
      }
      if (held) return -1
      const free = fit(width)
      if (!free) return -1
      carve(free.i, free.at, width, key)
      return free.at
    },
    widthFor,
    /** The bytes `page` holds: its span's. */
    widthOf: (page: ResidentPage) => sizes[indexOf(page.offset)],
    /** `page` left without an arrival to take its place: free for the next one. */
    freed(page: ResidentPage) {
      const i = indexOf(page.offset)
      if (keys[i] === page.key) release(i)
    },
    /** How many places no page holds: the homes empty while the pool holds the catalogue, else
     *  the widest grains its free bytes make, a part of one counted whole — a page under the widest
     *  takes it, and a pool of small pages refuses none while one byte of its grains is free. */
    get free() {
      return held ? held.homes.size - count : ceilDiv(freeBytes, widest)
    },
  }
}

export type Placement = ReturnType<typeof createPlacement>
