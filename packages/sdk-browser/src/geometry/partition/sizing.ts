/**
 * HOW MANY ROWS A PARTITIONED SCENE HOLDS AT ONCE, bound by the grids' ranges and not by the
 * world: moving content never runs a mesh short of rows, so it never reopens a session nor leaves
 * a node undrawn (CONTRIBUTING.md §Streaming, rule 10).
 *
 * After a frame, every placed cell has a box within `reach` of the eye, in the root's frame
 * (`placedReach`, `createCellPlan`). Under the root itself, that box meets the cube of side `2·reach`
 * around the eye. Under a core parent that stretches the root's frame by `least` to `most`
 * (`boxes.ts`), the box a cell carries in the root's frame is the box around its own turned box,
 * at most `√3·most·r` from the centre of that one, `r` the half diagonal of the widest cell (half
 * the root's `cube`); a gap there is at least `least` times the one in the parent's frame. So in
 * the parent's frame the cell's centre, within its box, lies within `(reach + √3·most·r)/least` of
 * the eye: its box meets the cube of twice that side. The cook lists, per mesh, the most nodes
 * the cells of one parent meeting any cube of a side place, summed over the parents, for a ladder
 * of sides (`partition/pages/rows.rs`); the rows take the rung of the widest cube the parents ask.
 * A reach past it, or a parent scaled down or stretched more unevenly, asks a wider rung: the rows
 * grow in place where the engine takes it, else the owner is told and the cells past them wait (`cells.ts`).
 * Beside them, at any rung, the rows of the HLOD actors read — the objects standing as themselves
 * in them (`../hlod/hlodRows.ts`) —: an actor loads with its grid's range, never with the view's
 * cube, and a mesh its rows find short grows for the actors loaded then (`createRowSizing`).
 */
import { RUNGS, type TablePartition } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import type { PlacementGrowth } from '../../placement/engineSceneUpdates.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import type { Stretch } from './boxes.ts'
import type { CellFrameIo } from './cellsPrime.ts'
import { summedNeeds, type PartitionShare } from './cellShare.ts'
import { capacityOf, sizeRows, type PlacedMesh } from './rows.ts'
import { SQRT3 } from '../../../../math/src/constants.ts'

/** The rounding a recomposed world matrix carries, far above a double's and far below any scale a
 *  page sets: a parent turned and moved back asks no wider rung. */
const SLACK = 2 ** -20

/** The side of the cube, in each parent's frame, that holds every box a frame of `reach`, in the
 *  root's frame, can hold under it, the widest cell's diagonal `cube` and each parent's `stretch`
 *  given; `Infinity` under a flattened parent. */
export function heldSide(reach: number, cube: number, stretch: ReadonlyMap<number, Stretch>) {
  let side = 2 * reach
  for (const [least, most] of stretch.values()) {
    const low = least * (1 - SLACK),
      high = most * (1 + SLACK)
    side = Math.max(side, low > 0 ? (2 * (reach + SQRT3 * high * (cube / 2))) / low : Infinity)
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

/** The rows of each mesh at `rung`: every node the partition places past the ladder; and beside
 *  them, at any rung, the rows of the HLOD actors read (`actors`, `../hlod/hlodRows.ts`). */
const rowsAt = (partition: TablePartition, rung: number, actors: ReadonlyMap<number, number>) =>
  new Map(
    [...partition.totals].map(([mesh, total]) => [
      mesh,
      (rung < RUNGS ? Math.min(total, partition.rows.get(mesh)![rung]) : total) +
        (actors.get(mesh) ?? 0),
    ]),
  )

/** Whether the rows of `meshes` hold `needs` — the rows each mesh asks at the last rung
 *  (`rowsAt`) — for each of `placements` placements: no wider rung asks for more. */
const holdsEvery = (
  needs: ReadonlyMap<number, number>,
  meshes: ReadonlyMap<number, PlacedMesh>,
  placements: number,
) =>
  [...needs].every(([mesh, total]) => {
    const placed = meshes.get(mesh)
    return !placed || capacityOf(placed) >= total * placements
  })

/**
 * The rows placement `self` of a partition asks of `meshes` in `share` — what its view's rung
 * holds (`rowsAt`) and the rows of the HLOD actors it read (`actors.loaded`) —, every placement's
 * summed as they are sized (`summedNeeds`). A rung the view outgrew sizes them anew, twice the side
 * that outgrew them, as buffers grow: an ongoing zoom resizes O(log) times; so does a mesh an
 * actor's rows found short since (`actors.shortage`), once a shortage. Either grows them in place
 * under the session's growth, else tells the owner (`outgrown`) and what waits waits.
 */
export function createRowSizing(
  partition: TablePartition,
  meshes: ReadonlyMap<number, PlacedMesh>,
  [share, self]: readonly [PartitionShare, object],
  actors: { readonly loaded: ReadonlyMap<number, number>; readonly shortage: number },
) {
  /** The rung the rows are sized for (`RUNGS`: all), the widest a view asked, and the actors'
   *  shortage they were last sized at. */
  let sized = -1,
    wanted = -1,
    short = 0
  /** Sizes the rows for `rung`, in place under `grow`; false, unsized, if refused. */
  const resize = (rung: number, grow?: PlacementGrowth) => {
    const before = share.needs.get(self)
    short = actors.shortage
    share.needs.set(self, rowsAt(partition, rung, actors.loaded))
    if (!sizeRows(meshes, summedNeeds(share.needs), grow)) {
      if (before) share.needs.set(self, before)
      else share.needs.delete(self)
      return false
    }
    // Rows that hold every node for every placement hold any view: no wider rung asks for more.
    const every = holdsEvery(rowsAt(partition, RUNGS, actors.loaded), meshes, share.needs.size)
    sized = every ? RUNGS : Math.max(sized, rung)
    return true
  }
  return {
    /** Before a frame whose view asks `rung`: the rows grown under `io` for it, or for the actors'
     *  rows found short since. */
    frame(rung: number, io: Pick<CellFrameIo, 'grow' | 'outgrown'>) {
      const wider = rung > Math.max(sized, wanted)
      if (!wider && actors.shortage === short) return
      if (wider) wanted = rung
      const next = wider ? clamp(sized + 2, rung, RUNGS) : Math.max(sized, 0)
      if (!io.grow || !resize(next, io.grow)) io.outgrown?.()
    },
    /** Before the engines read the rows: sized for the placed cells' reach, the view's `rung`, or
     *  the widest a frame asked — every node unless `owned`. */
    prime(rung: number, owned: boolean) {
      if (sized < RUNGS) resize(owned ? Math.max(rung, wanted) : RUNGS)
    },
    /** Its rows given back, its view asks none: the other placements size for theirs alone. */
    clear() {
      share.needs.delete(self)
      sized = wanted = -1
    },
  }
}
