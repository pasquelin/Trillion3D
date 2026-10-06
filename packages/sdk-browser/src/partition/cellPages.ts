/**
 * THE MANIFEST PAGES AND WORLD BUNDLES A PARTITION'S CELLS HOLD. A cell placed holds
 * the mesh pages its region page names (`TableCell.meshPages`), counted once per cell: a page many
 * cells share stays read while one of them is placed. A cell that leaves releases them, and a page
 * no placed cell holds leaves the manifest with its primitives (`ManifestPages`). It holds the
 * same way the world bundles past the pinned top its objects' roots depend on (`world`,
 * `../scene/worldRoots.ts`). Both are read through the session's queue at the priority the cell is
 * held with, and a cell that leaves while its hold reads lets its reads go at once: those still
 * queued are never fetched. A hold that failed holds nothing; the plan asks it again, at the
 * priority its view gives it then, once its own wait is over — 0.5 s · 2^(k−1) after its k-th
 * failure in a row, at most 8 s, never for one another request would meet again (`backoff`) —,
 * the earliest wait read by a frame at O(1) cost (`due`). Without `pages` the manifest was read
 * whole: every mesh the cells place has its primitive from the open.
 */
import type { ManifestPages, PageAsk } from '../../../sdk-core/src/manifest/paged.ts'
import type { PlacedMesh } from './rows.ts'
import type { WorldRootsHold } from '../scene/worldRoots.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'
import { backoff } from '../streaming/failures.ts'

/** What a placed cell holds from one source, counted per cell. */
type Holder = Pick<WorldRootsHold, 'hold' | 'release'>

/** What a partition's cells hold: each rank's placed mesh, and the manifest pages the cells hold.
 *  Kept beside the cells, not on them: a model's public record carries the cells. */
export type CellHoldings = {
  meshes: ReadonlyMap<number, PlacedMesh>
  manifest: ReturnType<typeof createCellPages>
}
const holdings = new WeakMap<object, CellHoldings>()
/** `cells`, with `holding` kept beside them. */
export function withHoldings<T extends object>(holding: CellHoldings, cells: T): T {
  holdings.set(cells, holding)
  return cells
}
/** What the cells `withHoldings` returned hold. */
export const cellHoldings = (cells: object) => holdings.get(cells)!

/** The holder of the mesh pages of `pages`, each cell's read through `meshPagesOf` when it is
 *  held and kept until it is released: its index page may close first. Counted per hold, landed or
 *  not: a cell that left and came back while its first hold read holds twice, and each release
 *  lets one go. */
function meshPagesHolder(pages: ManifestPages, meshPagesOf: (cell: number) => readonly string[]) {
  const slotsOf = new Map<number, { slots: readonly string[]; holds: number }>()
  return {
    hold(cell: number, asked?: PageAsk) {
      const slots = meshPagesOf(cell),
        own = slotsOf.get(cell)
      if (own) own.holds++
      else slotsOf.set(cell, { slots, holds: 1 })
      return pages.hold(slots, asked)
    },
    release(cell: number) {
      const own = slotsOf.get(cell)!
      pages.release(own.slots)
      if (--own.holds === 0) slotsOf.delete(cell)
    },
  } satisfies Holder
}

/** The holds on their way, and what a frame waits on: the next to land or fail, asked as a list of
 *  one made when first asked, or nothing while none reads. */
function createLandings() {
  const none: readonly Promise<void>[] = []
  let next: { asked: Promise<void>[]; settle: () => void } | undefined,
    reading = 0
  return {
    started: () => void reading++,
    settled() {
      reading--
      next?.settle()
      next = undefined
    },
    asked() {
      if (!reading) return none
      if (next) return next.asked
      let settle!: () => void
      const promise = new Promise<void>((resolve) => (settle = resolve))
      return (next = { asked: [promise], settle }).asked
    },
  }
}

/** The cells whose hold failed: each its failures in a row and when it is asked again, and the
 *  earliest of those (`due`, `Infinity` while none waits). */
function createFailedHolds() {
  const failed = new Map<number, { tries: number; due: number }>()
  let next = Infinity
  return {
    /** `cell`'s hold failed its `tries`-th time in a row, with `error`. */
    add(cell: number, tries: number, error: unknown) {
      const due = performance.now() + backoff(tries, error)
      failed.set(cell, { tries, due })
      next = Math.min(next, due)
    },
    delete: (cell: number) => failed.delete(cell),
    due: () => next,
    /** The failed holds due at `now`, each taken out as it is given with its failures in a row. */
    *take(now: number) {
      next = Infinity
      for (const [cell, own] of failed)
        if (own.due > now) next = Math.min(next, own.due)
        else if (failed.delete(cell)) yield [cell, own.tries] as const
    },
  }
}

/** A cell's hold, held or read, left while it reads, what lets its reads go, and the failures in a
 *  row before it. Each hold is released once on every holder, landed or not
 *  (`WorldRootsHold.hold`). */
type Hold = { landed: boolean; left: boolean; stop: AbortController; tries: number }

/** The holds of the cells placed on `pages` and `world`. */
export function createCellPages(
  pages: ManifestPages | undefined,
  meshPagesOf: (cell: number) => readonly string[],
  world?: Holder,
) {
  const holders: Holder[] = world ? [world] : []
  if (pages) holders.push(meshPagesHolder(pages, meshPagesOf))
  /** Each cell's hold; the cells whose hold failed, their pages counted till the plan asks again. */
  const holding = new Map<number, Hold>(),
    failed = createFailedHolds(),
    landings = createLandings()
  const releaseAll = (cell: number) => holders.forEach((holder) => holder.release(cell))
  /** `cell`'s hold `own` settled, each holder's as `held`. */
  const settled = (cell: number, own: Hold) => (held: PromiseSettledResult<void>[]) => {
    landings.settled()
    own.landed = held.every(({ status }) => status === 'fulfilled')
    if (own.left) return releaseAll(cell) // left while it read
    if (own.landed) return
    holding.delete(cell)
    failed.add(cell, own.tries + 1, held.find((each) => each.status === 'rejected')?.reason)
  }
  const hold = (cell: number, priority = PRIORITY_VISIBLE, tries = 0) => {
    if (!holders.length || holding.has(cell)) return
    const own: Hold = { landed: false, left: false, stop: new AbortController(), tries }
    holding.set(cell, own)
    landings.started()
    const asked = { signal: own.stop.signal, priority }
    void Promise.allSettled(holders.map((h) => h.hold(cell, asked))).then(settled(cell, own))
  }
  return {
    /** The manifest's pages, `undefined` when it was read whole. */
    pages,
    /** `cell` was placed: its pages are held, and read at `priority` if they are not. */
    hold: (cell: number, priority?: number) => hold(cell, priority),
    /** `cell` left: its pages are released, its reads still queued let go. */
    release(cell: number) {
      if (failed.delete(cell)) return releaseAll(cell)
      const own = holding.get(cell)
      if (!own) return
      holding.delete(cell)
      own.left = !own.landed
      if (own.landed) releaseAll(cell)
      else own.stop.abort()
    },
    /** When the first failed hold is asked again: `Infinity` while none waits. */
    due: failed.due,
    /** The failed holds whose wait is over at `now` are held at the priority `priorityOf` gives
     *  each, and let go once the new hold counts. */
    retry(priorityOf: (cell: number) => number, now: number) {
      for (const [cell, tries] of failed.take(now)) {
        hold(cell, priorityOf(cell), tries)
        releaseAll(cell)
      }
    },
    /** What a frame waits on: the next hold to land or fail, while one reads. */
    reads: landings.asked,
    /** How many cells hold their pages now. */
    held: () => holding.size,
  }
}
