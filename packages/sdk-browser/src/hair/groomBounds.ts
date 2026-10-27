import { boxEmpty, boxGrow, boxUnion } from '../../../math/src/geometry/box.ts'
import { boxSphereOf, maximumAxisScale, transformBox, type BoxSphere } from './boxSphere.ts'

/** What a groom's bounds read of each of its groups: the box of its points and its greatest radius. */
export interface GroupExtent {
  readonly boundsMin: ArrayLike<number>
  readonly boundsMax: ArrayLike<number>
  readonly maxRadius: number
}

/**
 * The bounds of a groom in the world. The groups go one after the other: the box so far takes the
 * group's box, then is widened on every side by the width of the strands — the group's greatest
 * radius, taken back by the transform's greatest axis scale, because the strands' width does not
 * follow the transform and the widening is then scaled by it. The widening is applied to the whole
 * box so far, the boxes of the groups before included: a groom of several groups is widened by the
 * sum of the borders of the groups before each one, so its bounds are never short. The box is then
 * carried by `localToWorld` (column-major).
 */
export function groomBounds(
  groups: readonly GroupExtent[],
  localToWorld: ArrayLike<number>,
): BoxSphere {
  const unscale = 1 / maximumAxisScale(localToWorld)
  const box = new Float64Array(6)
  boxEmpty(box, 0)
  for (const group of groups) {
    boxUnion(
      box,
      0,
      group.boundsMin[0]!,
      group.boundsMin[1]!,
      group.boundsMin[2]!,
      group.boundsMax[0]!,
      group.boundsMax[1]!,
      group.boundsMax[2]!,
    )
    boxGrow(box, 0, box, 0, group.maxRadius * unscale)
  }
  // The box of the box's image, its sphere the one through its corners.
  return boxSphereOf(transformBox(box, localToWorld))
}
