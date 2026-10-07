/**
 * THE CELL AND NODE EACH ROW OF A PARTITION PLACES, a column of the rows (`PlacementRows.cells`): a
 * row carries a world matrix and no node of its own. What the world DAG's links read
 * (`../webgpu/pages/prepare/worldRoot.ts`): a row draws the world object of its cell's node for its
 * primitive (`../scene/worldObjects.ts`). Rows grown keep theirs, as their other columns
 * (`growPlacementRows`).
 */
import type { PlacementRows } from '../placement/rows.ts'

/** Where a row's node lies: its cell, its rank among the cell's nodes, and the mesh rank of each
 *  node of that cell, shared by the cell's rows. */
export type RowCell = { cell: number; node: number; meshes: Int32Array }

/** Row `index` of `rows` places `at` now, or nothing. */
export function setRowCell(rows: PlacementRows, index: number, at: RowCell | undefined) {
  ;(rows.cells ??= [])[index] = at
}

/** Where row `index` of `rows` lies, none when no cell placed it. */
export const rowCell = (rows: PlacementRows, index: number) => rows.cells?.[index]
