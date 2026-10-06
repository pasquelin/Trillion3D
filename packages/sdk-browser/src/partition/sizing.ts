/**
 * HOW MANY ROWS A PARTITIONED SCENE HOLDS AT ONCE (#404, #575), bound by the view and not by the
 * world: moving content never runs a mesh short of rows, so it never reopens a session nor leaves
 * a node undrawn (CONTRIBUTING.md §Streaming, rule 10).
 *
 * After a frame, every held cell has a box within `keep = reach·(1 + KEEP)` of the eye, in the
 * root's frame (`planCells`). Under the root itself, that box meets the cube of side `2·keep`
 * around the eye. Under a core parent that stretches the root's frame by `least` to `most`
 * (`boxes.ts`), the box a cell carries in the root's frame is the box around its own turned box,
 * at most `√3·most·r` from the centre of that one, `r` the half diagonal of the widest cell (half
 * the root's `cube`); a gap there is at least `least` times the one in the parent's frame. So in
 * the parent's frame the cell's centre, within its box, lies within `(keep + √3·most·r)/least` of
 * the eye: its box meets the cube of twice that side. The cook lists, per mesh, the most nodes
 * the cells of one parent meeting any cube of a side place, summed over the parents, for a ladder
 * of sides (`partition/pages/rows.rs`); the rows take the rung of the widest cube the parents ask.
 * A reach past it, or a parent scaled down or stretched more unevenly, asks a wider rung: the rows
 * grow in place where the engine takes it, else the owner opens the session again (`cells.ts`).
 */
import { RUNGS, type TablePartition } from '../../../sdk-core/src/scene/core/tablePartition.ts'
import type { Stretch } from './boxes.ts'
import { KEEP } from './plan.ts'

/** The rounding a recomposed world matrix carries, far above a double's and far below any scale a
 *  page sets: a parent turned and moved back asks no wider rung. */
const SLACK = 2 ** -20

/** The side of the cube, in each parent's frame, that holds every box a frame of `reach`, in the
 *  root's frame, can hold under it, the widest cell's diagonal `cube` and each parent's `stretch`
 *  given; `Infinity` under a flattened parent. */
export function heldSide(reach: number, cube: number, stretch: ReadonlyMap<number, Stretch>) {
  const keep = reach * (1 + KEEP)
  let side = 2 * keep
  for (const [least, most] of stretch.values()) {
    const low = least * (1 - SLACK),
      high = most * (1 + SLACK)
    side = Math.max(
      side,
      low > 0 ? (2 * (keep + Math.sqrt(3) * high * (cube / 2))) / low : Infinity,
    )
  }
  return side
}

/** The first rung whose side holds `side`: `RUNGS` past the ladder, where every node is a row. */
export function rungOf(side: number, cube: number) {
  if (!(side < Infinity)) return RUNGS
  let rung = Math.max(0, Math.ceil(2 * Math.log2(side / cube)))
  while (rung < RUNGS && cube * 2 ** (rung / 2) < side) rung++
  return Math.min(rung, RUNGS)
}

/** The rows of each mesh at `rung`: every node the partition places past the ladder. */
export const rowsAt = (partition: TablePartition, rung: number) =>
  new Map(
    [...partition.totals].map(([mesh, total]) => [
      mesh,
      rung < RUNGS ? Math.min(total, partition.rows.get(mesh)![rung]) : total,
    ]),
  )
