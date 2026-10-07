/**
 * THE MANIFEST PAGES AND WORLD BUNDLES A PARTITION'S CELLS HOLD. A cell placed holds
 * the mesh pages its region page names (`TableCell.meshPages`), counted once per cell: a page many
 * cells share stays read while one of them is placed. A cell that leaves releases them, and a page
 * no placed cell holds leaves the manifest with its primitives (`ManifestPages`). It holds the
 * same way the world bundles past the pinned top its objects' roots depend on (`world`,
 * `../scene/worldRoots.ts`). Both are read through the session's queue at the priority the cell is
 * held with, and a cell that leaves while its hold reads lets its reads go at once: those still
 * queued are never fetched. A read that fails and may pass waits its turn in the queue, the hold
 * still on its way (`../streaming/failures.ts`); a hold that fails for good stays failed till its
 * cell leaves: another read would meet it again. Without `pages` the manifest was read whole:
 * every mesh the cells place has its primitive from the open.
 */
import type { ManifestPages, PageAsk } from '../../../sdk-core/src/manifest/paged.ts'
import type { PlacedMesh } from './rows.ts'
import type { WorldRootsHold } from '../scene/worldRoots.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'

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

/** A cell's hold: whether it settled, landed or failed, and what lets its reads go — aborted, its
 *  cell left while it read. Each hold is released once on every holder, settled or not
 *  (`WorldRootsHold.hold`). */
type Hold = { settled: boolean; stop: AbortController }

/** The holds of the cells placed on `pages` and `world`. */
export function createCellPages(
  pages: ManifestPages | undefined,
  meshPagesOf: (cell: number) => readonly string[],
  world?: Holder,
) {
  const holders: Holder[] = world ? [world] : []
  if (pages) holders.push(meshPagesHolder(pages, meshPagesOf))
  /** Each placed cell's hold. */
  const holding = new Map<number, Hold>(),
    landings = createLandings()
  const releaseAll = (cell: number) => holders.forEach((holder) => holder.release(cell))
  /** `cell`'s hold `own` settled: one its cell left while it read is released now. */
  const settled = (cell: number, own: Hold) => () => {
    landings.settled()
    own.settled = true
    if (own.stop.signal.aborted) releaseAll(cell)
  }
  return {
    /** The manifest's pages, `undefined` when it was read whole. */
    pages,
    /** `cell` was placed: its pages are held, and read at `priority` if they are not. */
    hold(cell: number, priority = PRIORITY_VISIBLE) {
      if (!holders.length || holding.has(cell)) return
      const own: Hold = { settled: false, stop: new AbortController() }
      holding.set(cell, own)
      landings.started()
      const asked = { signal: own.stop.signal, priority }
      void Promise.allSettled(holders.map((h) => h.hold(cell, asked))).then(settled(cell, own))
    },
    /** `cell` left: its pages are released, its reads still queued let go. */
    release(cell: number) {
      const own = holding.get(cell)
      if (!own) return
      holding.delete(cell)
      if (own.settled) releaseAll(cell)
      else own.stop.abort()
    },
    /** What a frame waits on: the next hold to land or fail, while one reads. */
    reads: landings.asked,
    /** How many cells hold their pages now. */
    held: () => holding.size,
  }
}
