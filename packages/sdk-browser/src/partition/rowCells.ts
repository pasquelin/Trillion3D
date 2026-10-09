/**
 * THE CELL AND NODE EACH ROW OF A PARTITION PLACES, a column of the rows (`PlacementRows.cells`): a
 * row carries a world matrix and no node of its own. What the world DAG's links read
 * (`../webgpu/pages/prepare/worldRoot.ts`): a row draws the world object of its cell's node for its
 * primitive (`../scene/worldObjects.ts`). Rows grown keep theirs, as their other columns
 * (`growPlacementRows`).
 */
import type { PlacementRows } from '../placement/rows.ts'

/** Where a row's node lies (`PlacementRows.cells`): its cell and its rank among the cell's nodes. */
export type RowCell = NonNullable<NonNullable<PlacementRows['cells']>[number]>

/** The rows of each buffer whose cell moved since a backend last read them: what links each to
 *  the world object it draws. Beside the rows, no column of their public type; a grown buffer
 *  takes its predecessor's (`carryCellsMoved`). */
const cellsMoved = new WeakMap<PlacementRows, Set<number>>()

/** Row `index` of `rows` places `at` now, or nothing: noted for the backend that links rows to
 *  the world objects they draw (`takeCellsMoved`). */
export function setRowCell(rows: PlacementRows, index: number, at: RowCell | undefined) {
  ;(rows.cells ??= [])[index] = at
  let moved = cellsMoved.get(rows)
  if (!moved) cellsMoved.set(rows, (moved = new Set()))
  moved.add(index)
}

/** `grown`, made from `before` (`growPlacementRows`), keeps the rows noted there. */
export function carryCellsMoved(before: PlacementRows, grown: PlacementRows) {
  const moved = cellsMoved.get(before)
  if (moved) cellsMoved.set(grown, moved)
}

/** The rows of `rows` whose cell moved since they were last taken, each once: `visit` takes a row
 *  — true — or leaves it noted, a row no root reads yet (a growth not adopted). */
export function takeCellsMoved(rows: PlacementRows, visit: (index: number) => boolean) {
  const moved = cellsMoved.get(rows)
  if (!moved?.size) return
  for (const index of moved) if (visit(index)) moved.delete(index)
}

/** Where row `index` of `rows` lies, none when no cell placed it. */
export const rowCell = (rows: PlacementRows, index: number) => rows.cells?.[index]
