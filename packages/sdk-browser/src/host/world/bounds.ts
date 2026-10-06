import type { HostBoundedNode } from '../scene/graphNodes.ts'
import { BOX_VALUES, boxEmpty } from '../../../../sdk-core/src/index.ts'
import { boxUnionCollector } from '../../math/batchBoxes.ts'
import { createBoxTransformLot, type BoxTransformLot } from '../../math/batchRuntime.ts'
import { hostWorldPlacements } from './placements.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

/**
 * World bounds of a host subtree, computed by the core on flat boxes.
 *
 * Every object of the subtree that carries a geometry gives its local box, transformed by its world
 * matrix, and the union of the eight corners is taken. The world matrix is the transform tree's,
 * brought up to date by its frame pass (`pass.ts`). An object that holds its own box — instanced
 * meshes — prefers it to that of its geometry. The transform and the union are those of
 * `packages/sdk-core/src/math/primitives/box.ts`: the same bits, empty boxes, NaN and infinities
 * included.
 */

/** An empty flat box, ready for a union: low bounds at `+∞`, high at `−∞`. */
export function emptyWorldBox() {
  const box = new Float64Array(BOX_VALUES)
  boxEmpty(box, 0)
  return box
}

/**
 * LOCAL box that `object` carries, or `undefined` if it has none. The
 * object's box wins over that of its geometry, and a missing box is computed on demand — it is
 * a derivative of the vertices the host owns, not a transform.
 */
function localBoxOf(object: HostBoundedNode) {
  if (object.boundingBox !== undefined) {
    if (object.boundingBox === null) object.computeBoundingBox?.()
    return object.boundingBox ?? undefined
  }
  const geometry = object.geometry
  if (!geometry) return undefined
  if (geometry.boundingBox === null) geometry.computeBoundingBox()
  return geometry.boundingBox ?? undefined
}

/** Bounded objects of the subtree: the EXACT size the box lot must carry. */
function boundedCount(source: Object3D) {
  let n = 0
  source.traverse((object) => {
    if (localBoxOf(object as HostBoundedNode)) n++
  })
  return n
}

/** Lot that carries this subtree's boxes, or `null` when it has none. */
export async function hostBoundsLot(source: Object3D) {
  const n = boundedCount(source)
  return n ? await createBoxTransformLot(n) : null
}

/**
 * Union of the world bounds of `source` and its descendants into `into`, which must arrive empty
 * or already started. The world matrices are the transform tree's after one frame pass, which
 * walks only what changed since the last. When `lot` carries exactly these boxes, they go AS A
 * LOT through the governor; otherwise each goes alone, by the same `boxTransform` and on the same
 * inputs.
 */
export function hostWorldBounds(
  source: Object3D,
  into = emptyWorldBox(),
  lot?: BoxTransformLot | null,
) {
  const worlds = hostWorldPlacements(source)
  const union = boxUnionCollector(into, lot, boundedCount(source))
  source.traverse((object) => {
    const box = localBoxOf(object as HostBoundedNode)
    if (!box) return
    const out = union.boxes,
      at = union.at
    out[at] = box.min.x
    out[at + 1] = box.min.y
    out[at + 2] = box.min.z
    out[at + 3] = box.max.x
    out[at + 4] = box.max.y
    out[at + 5] = box.max.z
    union.pose(worlds.of(object).elements)
  })
  return union.ferme()
}
