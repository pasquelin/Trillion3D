/**
 * THE WORLD BUNDLES A PARTITION'S CELLS HOLD, the one registry of its held cells. A placed cell —
 * or one held far by its super-roots (`farCells.ts`) — holds the world bundles past the pinned top
 * its objects' roots depend on (`world`, `../scene/worldRoots.ts`), counted once per cell, until it
 * is released: a cell demoted to its super-roots, or promoted to its objects, keeps its one hold
 * and changes its state alone, its bundles never released then read again. They are read
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

/** The holds of the cells held on `world`, placed or far, each kept until its cell is released;
 *  none without a world. A hold counts its bundles at once (`WorldRootsHold.hold`): its release
 *  lets them go at once too, and its reads still queued with them. */
export function createCellHolds(world?: Holder) {
  /** What lets each held cell's reads go, and whether it is held far, by its super-roots alone. */
  const holding = new Map<number, { stop: AbortController; far: boolean }>(),
    landings = createLandings()
  return {
    /** `cell` is held — `far`, by its super-roots alone, else placed —: its bundles are held, and
     *  read at `priority` if they are not; a cell held already only takes its new state. */
    hold(cell: number, priority = PRIORITY_VISIBLE, far = false) {
      if (!world) return
      const own = holding.get(cell)
      if (own) return void (own.far = far)
      const stop = new AbortController()
      holding.set(cell, { stop, far })
      landings.started()
      world.hold(cell, { signal: stop.signal, priority }).then(landings.settled, landings.settled)
    },
    /** `cell` left: its bundles are released, its reads still queued let go. */
    release(cell: number) {
      const own = holding.get(cell)
      if (!own) return
      holding.delete(cell)
      own.stop.abort()
      world!.release(cell)
    },
    /** Whether `cell` is held far. */
    far: (cell: number) => holding.get(cell)?.far === true,
    /** The cells held far now. */
    *farCells() {
      for (const [cell, own] of holding) if (own.far) yield cell
    },
    /** What a frame waits on: the next hold to land or fail, while one reads. */
    reads: landings.asked,
    /** How many cells hold their bundles now. */
    held: () => holding.size,
  }
}
