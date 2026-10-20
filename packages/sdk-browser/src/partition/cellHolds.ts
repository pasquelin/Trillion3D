/**
 * THE WORLD BUNDLES A PARTITION'S HLOD CELLS HOLD, the one registry of its held cells. A cell
 * whose actor is loaded (`hlodCells.ts`) holds the world bundles of its actor's roots
 * (`world`, `../scene/worldRoots.ts`), counted once per cell, until it is released. They are read
 * through the session's queue at the priority the cell is held with, and a cell that leaves while
 * its hold reads lets its reads go at once: those still queued are never fetched. A read that fails
 * and may pass waits its turn in the queue, the hold still on its way
 * (`../streaming/failures.ts`), and one whose session closed reads in the next one
 * (`worldBundles.ts`); a hold that fails for good stays failed till its cell leaves: another read
 * would meet it again.
 */
import type { WorldRootsHold } from '../scene/worldRoots.ts'
import { createDeferred } from '../../../sdk-core/src/runtime/deferred.ts'

/** What a held cell holds, counted per cell. */
type Holder = Pick<WorldRootsHold, 'hold' | 'release' | 'lift'>

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
      const { promise, resolve: settle } = createDeferred<void>()
      return (next = { asked: [promise], settle }).asked
    },
  }
}

/** The holds of the cells held on `world`, each kept until its cell is released; none without a
 *  world. A hold counts its bundles at once (`WorldRootsHold.hold`): its release lets them go at
 *  once too, and its reads still queued with them. */
export function createCellHolds(world?: Holder) {
  /** Per held cell, what lets its reads go and the priority they are read at; the held cells whose
   *  hold failed for good. */
  const holding = new Map<number, { stop: AbortController; priority: number }>(),
    failed = new Set<number>(),
    landings = createLandings()
  /** Advanced by every hold, release and failure. */
  let revision = 0
  return {
    /** `cell` is held: its bundles are held, and read at `priority` if they are not; a cell held
     *  already has its reads still queued lifted to `priority`, when more urgent. */
    hold(cell: number, priority: number) {
      if (!world) return
      const own = holding.get(cell)
      if (own) {
        if (priority >= own.priority) return
        own.priority = priority
        return void world.lift(cell, { signal: own.stop.signal, priority })
      }
      const stop = new AbortController()
      holding.set(cell, { stop, priority })
      revision++
      landings.started()
      world.hold(cell, { signal: stop.signal, priority }).then(landings.settled, () => {
        if (!stop.signal.aborted) {
          failed.add(cell)
          revision++
        }
        landings.settled()
      })
    },
    /** `cell` left: its bundles are released, its reads still queued let go. */
    release(cell: number) {
      const own = holding.get(cell)
      if (!own) return
      holding.delete(cell)
      failed.delete(cell)
      revision++
      own.stop.abort()
      world!.release(cell)
    },
    /** The cells held now. */
    cells: () => holding.keys(),
    /** Whether `cell`'s hold failed for good: its actor never comes while it stays held. */
    failed: (cell: number) => failed.has(cell),
    /** Advanced by every hold, release and failure. */
    get revision() {
      return revision
    },
    /** What a frame waits on: the next hold to land or fail, while one reads. */
    reads: landings.asked,
  }
}
