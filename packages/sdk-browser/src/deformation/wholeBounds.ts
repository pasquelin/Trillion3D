import { boxTransform, boxEquals, boxGrow } from '../../../math/src/geometry/box.ts'
import { boxUnionBatch } from '../../../math/src/batch/batch.ts'

import { readHostBox } from '../host/world/bounds.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { SessionDeformation } from './session.ts'
import { noteDeformedBounds } from '../webgpu/pages/render/movedGeometry.ts'
import { noteKeyRecord } from '../webgpu/blend/keyRecords.ts'
import { waterRankOf } from '../webgpu/transparent/transmission.ts'

const local = new Float64Array(6),
  before = new Float64Array(6)

/**
 * Whole-copy bounds use the same measured reach as clustered placements and dirty only their
 * region. A record that did not change can still be carried by its node (`worldsMoved`): a skin
 * palette, morph weights and soft sources are read in the mesh's own frame, so the box follows the
 * matrix too. A changed record dirties its region even inside the same box (its surface moved); a
 * carried one only when its box changed. A rewritten box goes to the item's key record, which the
 * GPU verdict and order read (`noteKeyRecord`); a matrix move rewrites them all that frame anyway.
 * The grown local box is kept too (`deformLocal`): the water rectangle encloses it under the pose,
 * so a deformed vertex never lies outside the rectangle the water pass covers.
 */
export function updateWholeDeformationBounds(
  rt: WebgpuPagesRuntime,
  deformation: SessionDeformation,
  worldsMoved: boolean,
) {
  const items = rt.blendState.blendGpu
  for (let rank = 0; rank < items.length; rank++) {
    const item = items[rank],
      box = item.deformBounds,
      source = item.sourceGeometry.boundingBox
    const changed = deformation.changedOfWorld(item.matrix)
    if (!box || !source || !(worldsMoved || changed)) continue
    before.set(box)
    readHostBox(source, local, 0)
    boxGrow(local, 0, local, 0, deformation.reachOfWorld(item.matrix))
    const grown = (item.deformLocal ??= new Float64Array(6))
    if (!boxEquals(grown, 0, local, 0)) {
      grown.set(local)
      if (waterRankOf(item.flags)) rt.blendState.waterItemsMoved = true
    }
    boxTransform(box, 0, local, 0, item.matrix.elements)
    // The key record follows the box the item now names: new values, or this box taking over from
    // its world box (`refreshBlendWorlds`).
    const switched = item.bounds !== box
    item.bounds = box
    const same = boxEquals(box, 0, before, 0)
    if (!same || switched) noteKeyRecord(rt.blendState, rank)
    if (same && !changed) continue
    boxUnionBatch(before, box, 1)
    noteDeformedBounds(rt, before)
  }
}
