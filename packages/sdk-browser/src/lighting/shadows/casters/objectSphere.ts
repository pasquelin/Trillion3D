import { BOX_VALUES, boxEmpty, boxIsEmpty, boxUnion } from '../../../../../math/src/geometry/box.ts'
import { sphereFromBounds } from '../../../../../math/src/geometry/sphere.ts'
import type { DagRoot } from '../../../geometry/dag/types.ts'
import type { PageRec } from '../../../geometry/selection/types.ts'
import type { Placements } from '../../../geometry/selection/placements.ts'
import type { WorldMemo } from '../../../geometry/selection/rootWorld.ts'

/** What a row's object is read from: its root's world and local box and deformation reach, and, a
 *  root of the world DAG, the HLOD cell of each page (`hlod.cells`, by the page's rank) and its
 *  pages. */
export type ObjectRoot = Placements[number] &
  WorldMemo & {
    pages?: Pick<DagRoot['pages'][number], 'min' | 'max'>[]
    hlod?: Pick<NonNullable<DagRoot['hlod']>, 'cells' | 'parent'>
  }

/** The box of each HLOD cell's actor, six numbers a cell, by the world DAG that holds them: the
 *  union of the boxes of the pages the cell's actor wears — an empty box, a low over its high, for
 *  a cell none wears. Shared by every placement of the DAG, made once. */
const ACTORS = new WeakMap<object, Float64Array>()

function actorBoxes(
  hlod: NonNullable<ObjectRoot['hlod']>,
  pages: NonNullable<ObjectRoot['pages']>,
) {
  let boxes = ACTORS.get(hlod)
  if (boxes) return boxes
  const cells = hlod.parent.length
  boxes = new Float64Array(cells * BOX_VALUES)
  for (let cell = 0; cell < cells; cell++) boxEmpty(boxes, cell * BOX_VALUES)
  for (let rank = 0; rank < pages.length; rank++) {
    const cell = hlod.cells[rank],
      { min, max } = pages[rank]
    if (cell >= 0 && cell < cells && min && max)
      boxUnion(boxes, cell * BOX_VALUES, min[0], min[1], min[2], max[0], max[1], max[2])
  }
  ACTORS.set(hlod, boxes)
  return boxes
}

/**
 * The sphere of the whole object a row belongs to, in the root's local space, written at `out[at]`
 * as centre then radius: the sphere about its box's centre that holds the box, grown by the root's
 * deformation reach. The object is what a shadow's far-shadow test judges whole, all or nothing
 * (`vsmRenderFarDepth`): the root's box for a placement drawn as itself, the box of the actor a
 * world DAG page belongs to for a page of the merged HLOD levels — a root there holds the whole
 * world. False, `out` left as it is, for a row whose root has no box.
 */
export function objectSphere(
  out: Float64Array,
  at: number,
  rec: Pick<PageRec, 'id' | 'hlodLayer'>,
  root: ObjectRoot,
) {
  const local = root.localBox
  if (!(root.worldBox && local && !boxIsEmpty(local, 0))) return false
  let box: ArrayLike<number> = local,
    from = 0
  if (root.hlod && root.pages && rec.hlodLayer !== undefined) {
    const boxes = actorBoxes(root.hlod, root.pages),
      cell = root.hlod.cells[rec.id]
    if (cell >= 0 && !boxIsEmpty(boxes, cell * BOX_VALUES)) {
      box = boxes
      from = cell * BOX_VALUES
    }
  }
  sphereFromBounds(
    out,
    at,
    box[from],
    box[from + 1],
    box[from + 2],
    box[from + 3],
    box[from + 4],
    box[from + 5],
  )
  out[at + 3] += root.reach ?? 0
  return true
}
