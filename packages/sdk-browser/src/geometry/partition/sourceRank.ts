/**
 * HOW THE CELLS A VIEW WISHES RANK (`source.ts`): the order they load in is by distance, as the
 * scheme says. A loose cell ranks by the squared 3D distance from the eye to its box over the
 * squared radius, at most 1 — the largest when the radius is nearly zero —, times half the cosine
 * of the axis the cells are sorted by with the way from the box to the eye plus a half; a square
 * cell by the squared distance to its centre times its angle factor squared.
 *
 * Cost: O(1) per cell ranked.
 */
import { DEG2RAD } from '../../../../math/src/constants.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { slabCut } from '../../../../math/src/geometry/slab.ts'
import type { WorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { LoadingCell } from './loadOrder.ts'
import type { createSourceShape, ViewPose } from './sourceShape.ts'

/** A square under which a division by it gives the largest ratio: 1e-8 square centimetres, in
 *  square metres. */
const NEARLY_ZERO_SQUARED = 1e-12

const span = new Float64Array(2),
  origin = [0, 0, 0],
  direction = [0, 0, 0],
  point = [0, 0],
  pointsX = new Float64Array(5),
  pointsZ = new Float64Array(5)

/** The smallest angle, over π, between the heading of `pose` and the way to the corners and the
 *  centre `(cx, cz)` of the box `bounds` at `at`, none when the heading's ray across `reach` meets
 *  the box. */
function headingAngle(
  pose: ViewPose,
  toward: ReturnType<typeof createSourceShape>['toward'],
  bounds: ArrayLike<number>,
  at: number,
  [cx, cz]: readonly [number, number],
  reach: number,
) {
  const { eye, heading } = pose
  origin[0] = eye[0]
  origin[1] = bounds[at + 1]
  origin[2] = eye[1]
  direction[0] = heading[0] * reach
  direction[2] = heading[1] * reach
  span[0] = 0
  span[1] = 1
  if (slabCut(span, bounds, at, bounds, at + 3, origin, direction)) return 0
  pointsX[0] = pointsX[1] = bounds[at]
  pointsX[2] = pointsX[3] = bounds[at + 3]
  pointsX[4] = cx
  pointsZ[0] = pointsZ[2] = bounds[at + 2]
  pointsZ[1] = pointsZ[3] = bounds[at + 5]
  pointsZ[4] = cz
  let most = 0
  for (let k = 0; k < 5; k++) {
    toward(pointsX[k], pointsZ[k], point)
    most = Math.max(most, heading[0] * point[0] + heading[1] * point[1])
  }
  return Math.acos(clamp(most, -1, 1)) / Math.PI
}

/** The ranks of the view `pose` under the settings `streaming` holds as they stand, its circle's
 *  radius for a grid of range `range` `radiusOf`, the axis its loose cells are sorted by `rankAxis`,
 *  its distances those of `shape`. */
export function createSourceRank(
  streaming: WorldStreaming,
  pose: ViewPose,
  { toward, gap, gapTo }: Pick<ReturnType<typeof createSourceShape>, 'toward' | 'gap' | 'gapTo'>,
  rankAxis: readonly number[],
  radiusOf: (range: number) => number,
) {
  const { eye } = pose
  /** A loose cell's rank by distance: the squared 3D distance from the eye to its box over the
   *  squared radius, at most 1, times half the cosine of the view's axis with the way from the box
   *  to the eye plus a half — the cosine -1 from within or on it —; and that squared distance. */
  const loose = (bounds: ArrayLike<number>, at: number, range: number, out: LoadingCell) => {
    const squared = gapTo(bounds, at)
    const along = rankAxis[0] * gap[0] + rankAxis[1] * gap[1] + rankAxis[2] * gap[2]
    const cosine = squared > 0 ? along / Math.sqrt(squared) : -1
    const radius = radiusOf(range)
    const ratio =
      radius * radius > NEARLY_ZERO_SQUARED ? clamp(squared / (radius * radius), 0, 1) : 1
    out.distance = ratio * (cosine * 0.5 + 0.5)
    out.raw = squared
    return out
  }
  /** A square cell's rank by distance: the squared distance from the eye to its centre times its
   *  angle factor squared — its smallest angle to the heading over π, its corners and centre
   *  tried, unless the heading's ray across the radius meets it, at least a degree's, raised to
   *  `angleWeight` —, and that squared distance alone. */
  const square = (bounds: ArrayLike<number>, at: number, range: number, out: LoadingCell) => {
    const cx = (bounds[at] + bounds[at + 3]) / 2,
      cz = (bounds[at + 2] + bounds[at + 5]) / 2
    const raw = (cx - eye[0]) ** 2 + (cz - eye[1]) ** 2
    let factor = 1
    if (pose.headed && streaming.angleWeight > 0) {
      const angle = headingAngle(pose, toward, bounds, at, [cx, cz], radiusOf(range))
      factor = clamp(angle, DEG2RAD, 1) ** streaming.angleWeight
    }
    out.distance = raw * factor * factor
    out.raw = raw
    return out
  }
  return { loose, square }
}
