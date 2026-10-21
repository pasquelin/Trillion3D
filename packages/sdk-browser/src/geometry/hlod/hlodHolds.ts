/**
 * THE RANK OF THE HLOD CELLS IN THE LOAD ORDER, AND THE ORDER THEIR ACTORS' HOLDS ARE ASKED IN
 * (`hlodCells.ts`). A cell is ranked by its own place on its grid, as the view sees it at that
 * moment (`ranked`). Every hold reads in the cells' lane (`cellPriority`), by the turn of its unit:
 * the cell its actor lies in, its parent, which took its turn to load (`LoadSlots`); for an actor
 * always loaded, the unit of the actors always loaded of its level (`hlodTops.ts`). The cell files
 * of a unit read by that same priority (`../partition/plan.ts`), so the queue serves every read of
 * every cell — files and actors — in the one load order, whatever the order they are asked in. The
 * actors of one unit that come loaded together are asked in the order they came.
 *
 * Cost: O(1) a cell ranked; O(w) for the w cells whose actors came loaded together, nothing while
 * none did.
 */
import type { WorldRootsHold } from './worldRoots.ts'
import type { ActorRows } from './hlodRows.ts'
import type { createCellHolds } from '../partition/cellHolds.ts'
import type { LoadSlots } from '../partition/loadSlots.ts'
import { rankedCell } from '../partition/plan.ts'
import type { StreamingSource } from '../partition/source.ts'
import type { Tops } from './hlodTops.ts'
import type { PartitionGrid } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import { BOX_VALUES } from '../../../../math/src/geometry/box.ts'
import { appendTo } from '../../../../math/src/sequence/counts.ts'

/** The order the cells of `chain` on `grids` are ranked by the view `source`, and their actors'
 *  holds asked in of `holds` and `actorRows`, each by its unit's priority from `slots`, the units
 *  of the actors always loaded those of `tops`. */
export function createHoldOrder(
  chain: NonNullable<WorldRootsHold['table']>['chain'],
  grids: readonly PartitionGrid[],
  source: StreamingSource,
  slots: Pick<LoadSlots, 'priorityOf'>,
  tops: Pick<Tops, 'key'>,
  holds: ReturnType<typeof createCellHolds>,
  actorRows?: ActorRows,
) {
  /** The cells whose actors came loaded, not held yet. */
  const opened: number[] = []
  return {
    /** `cell` ranked in the load order (`LoadingCell`). */
    ranked(cell: number) {
      const at = BOX_VALUES * cell
      const bounds = chain.bounds.subarray(at, at + BOX_VALUES)
      return rankedCell(cell, bounds, [grids[chain.grid[cell]], chain.rung[cell]], source)
    },
    /** The actor of `cell` came loaded: held at the next `flush`. */
    open: (cell: number) => void opened.push(cell),
    /** The actors that came loaded and still are (`loaded`), held, each unit's by its priority. */
    flush(loaded: (cell: number) => boolean) {
      if (!opened.length) return
      const units = new Map<number, number[]>()
      for (const cell of opened) {
        if (!loaded(cell)) continue
        const up = chain.parent[cell]
        appendTo(units, up < 0 ? tops.key(cell) : up, cell)
      }
      opened.length = 0
      for (const [unit, cells] of units) {
        const priority = slots.priorityOf(unit)
        for (const cell of cells) {
          holds.hold(cell, priority)
          actorRows?.hold(cell, priority)
        }
      }
    },
    /** Every cell forgotten. */
    clear: () => void (opened.length = 0),
  }
}
