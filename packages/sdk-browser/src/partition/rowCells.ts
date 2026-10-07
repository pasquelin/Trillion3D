/**
 * THE CELL AND NODE EACH ROW OF A PARTITION PLACES, kept beside the rows, keyed by them: a
 * row carries a world matrix and no node of its own. What the world DAG's links read
 * (`../webgpu/pages/prepare/worldRoot.ts`): a row draws the world object of its cell's node for its
 * primitive (`../scene/worldObjects.ts`). Rows grown in place keep theirs (`carryRowCells`).
 */
import type { PlacementRows } from '../placement/rows.ts'

/** Where a row's node lies: its cell, its rank among the cell's nodes, and the mesh rank of each
 *  node of that cell, shared by the cell's rows. */
export type RowCell = { cell: number; node: number; meshes: Int32Array }

const placed = new WeakMap<PlacementRows, (RowCell | undefined)[]>()

/** Row `index` of `rows` places `at` now, or nothing. */
export function setRowCell(rows: PlacementRows, index: number, at: RowCell | undefined) {
  let own = placed.get(rows)
  if (!own) placed.set(rows, (own = []))
  own[index] = at
}

/** Where row `index` of `rows` lies, none when no cell placed it. */
export const rowCell = (rows: PlacementRows, index: number) => placed.get(rows)?.[index]

/** `to`, grown from `from` with its rows copied first, keeps where those rows lie. */
export function carryRowCells(from: PlacementRows, to: PlacementRows) {
  const own = placed.get(from)
  if (own) placed.set(to, own.slice())
}
