/**
 * THE MANIFEST PAGES AND WORLD BUNDLES A PARTITION'S CELLS HOLD. A cell placed holds
 * the mesh pages its region page names (`TableCell.meshPages`), counted once per cell: a page many
 * cells share stays read while one of them is placed. A cell that leaves releases them, and a page
 * no placed cell holds leaves the manifest with its primitives (`ManifestPages`). It holds the
 * same way the world bundles past the pinned top its objects' roots depend on (`world`,
 * `../scene/worldRoots.ts`), read at the priority it is held with. A cell that leaves while its hold
 * reads lets its world reads go at once: those still queued are never fetched. A hold that failed
 * holds nothing and is asked again while its cell is placed, once its wait is over (`retries.ts`);
 * past the longest wait its failure is said once (`said`). Without `pages` the manifest was read
 * whole: every mesh the cells place has its primitive from the open.
 */
import type { ManifestPages } from '../../../sdk-core/src/manifest/paged.ts'
import type { PlacedMesh } from './rows.ts'
import type { WorldRootsHold } from '../scene/worldRoots.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'
import { createHoldRetries, type HoldFailure } from './retries.ts'

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
 *  held and kept until it is released: its index page may close first. Counted per hold landed: a
 *  cell that left and came back while its first hold read lands twice, and each release lets one
 *  go. */
function meshPagesHolder(pages: ManifestPages, meshPagesOf: (cell: number) => readonly string[]) {
  const slotsOf = new Map<number, { slots: readonly string[]; holds: number }>()
  return {
    async hold(cell: number) {
      const slots = meshPagesOf(cell)
      await pages.hold(slots)
      const own = slotsOf.get(cell)
      if (own) own.holds++
      else slotsOf.set(cell, { slots, holds: 1 })
    },
    release(cell: number) {
      const own = slotsOf.get(cell)!
      pages.release(own.slots)
      if (--own.holds === 0) slotsOf.delete(cell)
    },
  } satisfies Holder
}

/** A promise a later event settles, made when first asked. */
function nextEvent() {
  let next: { promise: Promise<void>; settle: () => void } | undefined
  return {
    promise() {
      if (next) return next.promise
      let settle!: () => void
      const promise = new Promise<void>((resolve) => (settle = resolve))
      return (next = { promise, settle }).promise
    },
    settle() {
      next?.settle()
      next = undefined
    },
  }
}

/** The holds of the cells placed on `holders`, those that failed waiting their turn in `retries`. */
function createHolding(holders: readonly Holder[], retries: ReturnType<typeof createHoldRetries>) {
  /** Each cell's hold, held or read. One left while it reads releases once it lands: a failed hold
   *  counts nothing, and releasing it too would drop a page another cell holds. */
  type Hold = { landed: boolean; left: boolean; stop: AbortController; priority: number }
  const holding = new Map<number, Hold>(),
    landing = nextEvent()
  let reading = 0
  const settle = (cell: number, own: Hold, held: PromiseSettledResult<void>[]) => {
    reading--
    landing.settle()
    const landed = holders.filter((_, at) => held[at].status === 'fulfilled')
    if (landed.length === holders.length) {
      own.landed = true
      if (own.left) for (const holder of holders) holder.release(cell)
      else retries.over(cell)
      return
    }
    // What landed is let go: held again whole once its turn comes, unless the cell left.
    for (const holder of landed) holder.release(cell)
    if (holding.get(cell) !== own) return
    holding.delete(cell)
    const refused = held.find((result) => result.status === 'rejected') as PromiseRejectedResult
    retries.failed(cell, own.priority, refused.reason)
  }
  const hold = (cell: number, priority = PRIORITY_VISIBLE) => {
    if (!holders.length || holding.has(cell)) return
    const own: Hold = { landed: false, left: false, stop: new AbortController(), priority }
    holding.set(cell, own)
    reading++
    const asked = { signal: own.stop.signal, priority }
    void Promise.allSettled(holders.map((h) => h.hold(cell, asked))).then((held) =>
      settle(cell, own, held),
    )
  }
  return {
    /** `cell` was placed: its pages are held, and read at `priority` if they are not. */
    hold,
    /** `cell` left: its pages are released, its world reads still queued let go. */
    release(cell: number) {
      retries.over(cell)
      const own = holding.get(cell)
      if (!own) return
      holding.delete(cell)
      own.left = !own.landed
      if (own.landed) for (const holder of holders) holder.release(cell)
      else own.stop.abort()
    },
    /** The cells whose hold failed and whose turn came are held again; then what a frame waits
     *  on: the next hold to land or fail, while one reads. */
    reads() {
      for (const [cell, priority] of retries.due()) hold(cell, priority)
      return reading ? [landing.promise()] : []
    },
    /** Settles once the next cell whose hold failed is due again; `undefined` while none waits. */
    retry: retries.turn,
    /** How many cells hold their pages now. */
    held: () => holding.size,
  }
}

/** The holds of the cells placed on `pages` and `world`, a hold that keeps failing told `said`. */
export function createCellPages(
  pages: ManifestPages | undefined,
  meshPagesOf: (cell: number) => readonly string[],
  world?: Holder,
  said?: HoldFailure,
) {
  const holders: Holder[] = world ? [world] : []
  if (pages) holders.push(meshPagesHolder(pages, meshPagesOf))
  /** The manifest's pages, `undefined` when it was read whole. */
  return { pages, ...createHolding(holders, createHoldRetries(said)) }
}
