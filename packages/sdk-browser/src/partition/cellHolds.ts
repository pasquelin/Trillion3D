/**
 * THE WORLD BUNDLES A PARTITION'S CELLS HOLD. A placed cell — or one held far by its super-roots
 * (`farCells.ts`) — holds the world bundles past the pinned top its objects' roots depend on
 * (`world`, `../scene/worldRoots.ts`), counted once per cell, until it is released. They are read
 * through the session's queue at the priority the cell is held with, and a cell that leaves while
 * its hold reads lets its reads go at once: those still queued are never fetched. A read that fails
 * and may pass waits its turn in the queue, the hold still on its way
 * (`../streaming/failures.ts`), and one whose session closed reads in the next one
 * (`worldBundles.ts`); a hold that fails for good stays failed till its cell leaves: another read
 * would meet it again.
 */
import type { WorldRootsHold } from '../scene/worldRoots.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'

/** What a placed cell holds, counted per cell. */
type Holder = Pick<WorldRootsHold, 'hold' | 'release'>

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

/** The holds of the cells placed on `world`, each kept until its cell is released; none without
 *  a world. A hold counts its bundles at once (`WorldRootsHold.hold`): its release lets them go at
 *  once too, and its reads still queued with them. */
export function createCellHolds(world?: Holder) {
  /** What lets each held cell's reads go. */
  const holding = new Map<number, AbortController>(),
    landings = createLandings()
  return {
    /** `cell` was placed: its bundles are held, and read at `priority` if they are not. */
    hold(cell: number, priority = PRIORITY_VISIBLE) {
      if (!world || holding.has(cell)) return
      const stop = new AbortController()
      holding.set(cell, stop)
      landings.started()
      world.hold(cell, { signal: stop.signal, priority }).then(landings.settled, landings.settled)
    },
    /** `cell` left: its bundles are released, its reads still queued let go. */
    release(cell: number) {
      const stop = holding.get(cell)
      if (!stop) return
      holding.delete(cell)
      stop.abort()
      world!.release(cell)
    },
    /** What a frame waits on: the next hold to land or fail, while one reads. */
    reads: landings.asked,
    /** How many cells hold their bundles now. */
    held: () => holding.size,
  }
}
