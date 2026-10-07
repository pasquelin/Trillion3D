/**
 * THE WORLD BUNDLES A PARTITION'S CELLS HOLD. A placed cell — or one held far by its super-roots
 * (`farCells.ts`) — holds the world bundles past the pinned top its objects' roots depend on
 * (`world`, `../scene/worldRoots.ts`), counted once per cell, until it is released. They are read
 * through the session's queue at the priority the cell is held with, and a cell that leaves while
 * its hold reads lets its reads go at once: those still queued are never fetched. A read that fails
 * and may pass waits its turn in the queue, the hold still on its way
 * (`../streaming/failures.ts`); a hold that fails for good stays failed till its cell leaves:
 * another read would meet it again.
 */
import type { WorldRootsHold } from '../scene/worldRoots.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'

/** What a placed cell holds, counted per cell. */
type Holder = Pick<WorldRootsHold, 'hold' | 'release'>

const holdings = new WeakMap<object, CellHolds>()
/** `cells`, with their `holds` kept beside them: a model's public record carries the cells. */
export function withHolds<T extends object>(holds: CellHolds, cells: T): T {
  holdings.set(cells, holds)
  return cells
}
/** What the cells `withHolds` returned hold. */
export const cellHolds = (cells: object) => holdings.get(cells)!

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
 *  cell left while it read. Each hold is released once, settled or not (`WorldRootsHold.hold`). */
type Hold = { settled: boolean; stop: AbortController }

/** The holds of the cells placed on `world`, each kept until its cell is released; none without
 *  a world. */
export function createCellHolds(world?: Holder) {
  const holding = new Map<number, Hold>(),
    landings = createLandings()
  /** `cell`'s hold `own` settled: one its cell left while it read is released now. */
  const settled = (cell: number, own: Hold) => () => {
    landings.settled()
    own.settled = true
    if (own.stop.signal.aborted) world!.release(cell)
  }
  return {
    /** `cell` was placed: its bundles are held, and read at `priority` if they are not. */
    hold(cell: number, priority = PRIORITY_VISIBLE) {
      if (!world || holding.has(cell)) return
      const own: Hold = { settled: false, stop: new AbortController() }
      holding.set(cell, own)
      landings.started()
      const done = settled(cell, own)
      world.hold(cell, { signal: own.stop.signal, priority }).then(done, done)
    },
    /** `cell` left: its bundles are released, its reads still queued let go. */
    release(cell: number) {
      const own = holding.get(cell)
      if (!own) return
      holding.delete(cell)
      if (own.settled) world!.release(cell)
      else own.stop.abort()
    },
    /** What a frame waits on: the next hold to land or fail, while one reads. */
    reads: landings.asked,
    /** How many cells hold their bundles now. */
    held: () => holding.size,
  }
}

export type CellHolds = ReturnType<typeof createCellHolds>
