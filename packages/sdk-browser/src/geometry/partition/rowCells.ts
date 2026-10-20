/**
 * THE CELL AND NODE EACH ROW OF A PARTITION PLACES, a column of the rows (`PlacementRows.cells`): a
 * row carries a world matrix and no node of its own. What the world's links read
 * (`../../frame/prepare/worldRoot.ts`): a row lies in its cell's HLOD 0 cell, whose one
 * representation draws it or not (`../dag/worlds/worldLinks.ts`). Rows grown keep theirs, and the list
 * of those whose cell moved, as their other columns (`growPlacementRows`).
 */
import type { PlacementRows } from '../../placement/rows/rows.ts'
import { createChangedRuns } from '../residency/ranges.ts'

/** Where a row's node lies (`PlacementRows.cells`): its cell, its rank among the cell's nodes, its
 *  instance and its HLOD 0 cell. */
export type RowCell = NonNullable<NonNullable<PlacementRows['cells']>[number]>

/** Row `index` of `rows` places `at` now, or nothing: marked in the rows' one changed list
 *  (`PlacementRows.cellsMoved`) for the backend that links rows to the HLOD 0 cells they lie in
 *  (`takeCellsMoved`). */
export function setRowCell(rows: PlacementRows, index: number, at: RowCell | undefined) {
  rows.cells ??= []
  rows.cells[index] = at
  rows.cellsMoved ??= createChangedRuns()
  rows.cellsMoved.mark(index)
}

/** The rows of `rows` whose cell moved since they were last taken, each once, increasing: `visit`
 *  takes a row — true — or leaves it marked, a row no root reads yet (a growth not adopted). */
export function takeCellsMoved(rows: PlacementRows, visit: (index: number) => boolean) {
  const moved = rows.cellsMoved
  if (!moved?.count) return
  for (const index of moved.take()) if (!visit(index)) moved.mark(index)
}

/** Where row `index` of `rows` lies, none when no cell placed it. */
export const rowCell = (rows: PlacementRows, index: number) => rows.cells?.[index]
