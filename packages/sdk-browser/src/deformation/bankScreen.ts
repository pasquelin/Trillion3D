/**
 * THE SCREEN SIZE RULE OF A BANKED ROOT (`bankTracks.ts`): whether a root playing a track animates
 * for a view (`animates`), and how far a track's bounds reach past the root's rest box
 * (`boundsReach`).
 *
 * An instance animates while `max(P₀₀, P₁₁)² · r² ≥ s² · d²`, `P` the view's projection, `r` the
 * length of its item's bounds' half extent, each axis scaled by its world's, `d` the distance from
 * the eye to the world centre of those bounds, `s` its item's `minScreenSize` — the run-time
 * setting `animationMinScreenSize` where it is 0, and for a row drawn as its cell's HLOD 0 actor
 * (`RowCell.proxy`) whatever its own —; one whose `s` is negative always animates.
 */
import { boxCenter } from '../../../math/src/geometry/box.ts'
import {
  distanceSqVector3,
  lengthSqVector3,
  transformAffinePoint,
} from '../../../math/src/vector/vector.ts'
import type { BankTrack } from '../../../sdk-core/src/scene/core/animationBanks.ts'
import { rowCell } from '../geometry/partition/rowCells.ts'
import type { ClusterRoot, PageRec } from '../geometry/selection/types.ts'

/** How far the box `bounds` reaches past `box` on any side: none while it lies within it, or for a
 *  root whose rest box is unknown. */
export function boundsReach(bounds: Float64Array, box: Float64Array | undefined) {
  let most = 0
  for (let axis = 0; box && axis < 3; axis++)
    most = Math.max(most, box[axis] - bounds[axis], bounds[axis + 3] - box[axis + 3])
  return most
}

const centre = new Float64Array(3)

/** Whether `root` playing `track` animates for the view at `eye` whose projection's screen
 *  multiple squared is `multiple2`, under the run-time setting `setting` (the header's rule). */
export function animates(
  root: ClusterRoot<PageRec>,
  track: BankTrack,
  multiple2: number,
  eye: ArrayLike<number>,
  setting: number,
) {
  const item = track.banks.items[track.item],
    placement = root.placement,
    proxy = !!placement && !!rowCell(placement.rows, placement.index)?.proxy,
    own = proxy ? 0 : item.minScreenSize,
    least = own !== 0 ? own : setting
  if (least < 0) return true
  const world = root.world.elements,
    b = item.bounds
  let radius = 0
  for (let axis = 0; axis < 3; axis++) {
    const half = (b[axis + 3] - b[axis]) / 2
    radius += half * half * lengthSqVector3(world, axis * 4)
  }
  boxCenter(centre, 0, b[0], b[1], b[2], b[3], b[4], b[5])
  transformAffinePoint(centre, world, centre[0], centre[1], centre[2])
  return multiple2 * radius >= least * least * distanceSqVector3(centre, eye)
}
