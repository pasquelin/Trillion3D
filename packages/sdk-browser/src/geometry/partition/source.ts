/**
 * THE VIEW AS THE STREAMING SOURCE OF A PARTITIONED SCENE, as the partition's scheme says
 * (`TablePartition.scheme`).
 *
 * The camera is the scene's one streaming source (`createStreamingSource`), its shape set by the
 * session's streaming settings (`WorldStreaming`, `WORLD_STREAMING_SETTINGS`): at its eye, seen
 * from above while the grid lies flat (`PartitionGrid.flat`) or the settings force the ground
 * (`force2D`), its up axis dropped, a circle of each grid's own loading range scaled
 * (`useGridRange`, `rangeScale`), or of one radius for every grid (`radius`), and in both a radius
 * longer by `extraRadius` — a sphere of it while they do not —; a sector of it around the view's
 * axis when the settings ask one (`sector`, `sectorAngle` and `extraAngle`, a whole turn at most).
 * A cell is wished while that shape meets the bounds it streams by (`meets`), and, a sector, not
 * wholly beside or behind it: on `hashSet`'s loose grids, the box around its content within or on
 * the circle, the sector around the view's own axis without its up part — or within or on the
 * sphere, the sector a cone around the view's axis that the box's bounding sphere meets —; on
 * `spatialHash`'s square grids, its square strictly within the circle, the sector around the
 * view's unit heading on the ground, and, when the settings cull by height (`zCulling`), its
 * content's height range meeting the eye's within the radius.
 *
 * The tests of the sector and of the height cull are `sourceShape.ts`'s. What ranks the cells
 * wished and not loaded by distance (`ranked`) is the scheme's too: the
 * order they load in, and how many load at once, are `loadOrder.ts`'s and `loadSlots.ts`'s.
 *
 * Cost: O(1) per cell tested or ranked.
 */
import { DEG2RAD } from '../../../../math/src/constants.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { length2 } from '../../../../math/src/vector/vector.ts'
import { boxGroundDistance } from '../../../../math/src/geometry/boxDistance.ts'
import { slabCut } from '../../../../math/src/geometry/slab.ts'
import type { WorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type {
  PartitionGrid,
  TablePartition,
} from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import type { LoadingCell } from './loadOrder.ts'
import { createSourceShape, type ViewPose } from './sourceShape.ts'

/** The settings that shape the view's circle or sector: the update reads them too. */
export const SOURCE_SHAPE = [
  'useGridRange',
  'rangeScale',
  'radius',
  'sector',
  'sectorAngle',
  'force2D',
  'extraRadius',
  'extraAngle',
] as const
/** The settings `meets` and `radius` read. */
const READ = [...SOURCE_SHAPE, 'zCulling'] as const

/**
 * The view as the source for a partition of `scheme` whose grids (`hlod.grids`) lie flat or not,
 * under the settings `streaming` holds as they stand — read at each test, so a setting changed
 * takes from the next frame —, set each frame (`set`): its eye and the unit axis of its view, both
 * in the cells' frame. A flat loose grid's sector, or one the settings force to the ground (`force2D`),
 * turns around that axis with its up part dropped, unscaled; one that does not lie flat around
 * the axis itself; a square grid's around its unit heading on the ground, glTF's `+Y` up dropped.
 * A view looking straight down has no heading: a square grid's sector is then the whole circle,
 * and no angle weighs a cell's turn.
 */
export function createStreamingSource(
  streaming: WorldStreaming,
  {
    scheme,
    hlod,
  }: Pick<TablePartition, 'scheme'> & { hlod: { grids: readonly { flat: boolean }[] } },
) {
  const loose = scheme === 'hashSet'
  /** Whether the cells of a loose grid that lies `flat` or not are wished in 3D, by a sphere: it
   *  does not lie flat and the settings do not force the ground. */
  const solid = (flat: boolean) => loose && !flat && !streaming.force2D
  const pose: ViewPose = {
    eye: [0, 0],
    heading: [0, 0],
    eye3: [0, 0, 0],
    axis3: [0, 0, 0],
    headed: false,
  }
  const { eye, heading, eye3, axis3 } = pose
  const { toward, sectored, besideSector, beyondHeight, gap, gapTo, outsideCone } =
    createSourceShape(streaming, loose, pose)
  /** The circle's radius for a grid of loading range `range`, its extra radius added. */
  const radiusOf = (range: number) =>
    (streaming.useGridRange ? range * streaming.rangeScale : streaming.radius) +
    streaming.extraRadius
  /** A loose cell's rank by distance: the squared 3D distance from the eye to its box over the
   *  squared radius, at most 1, times half the cosine of the view's axis with the way from the box
   *  to the eye plus a half — the cosine -1 from within or on it —; and that squared distance. */
  const looseRanked = (bounds: ArrayLike<number>, at: number, range: number, out: LoadingCell) => {
    const squared = gapTo(bounds, at)
    const along = axis3[0] * gap[0] + axis3[1] * gap[1] + axis3[2] * gap[2]
    const cosine = squared > 0 ? along / Math.sqrt(squared) : -1
    const radius = radiusOf(range)
    const ratio = radius > 0 ? clamp(squared / (radius * radius), 0, 1) : 0
    out.distance = ratio * (cosine * 0.5 + 0.5)
    out.raw = squared
    return out
  }
  const span = new Float64Array(2),
    origin = [0, 0, 0],
    direction = [0, 0, 0],
    point = [0, 0],
    pointsX = new Float64Array(5),
    pointsZ = new Float64Array(5)
  /** A square cell's rank by distance: the squared distance from the eye to its centre times its
   *  angle factor squared — its smallest angle to the heading over π, its corners and centre
   *  tried, unless the heading's ray across the radius meets it, at least a degree's, raised to
   *  `angleWeight` —, and that squared distance alone. */
  const squareRanked = (bounds: ArrayLike<number>, at: number, range: number, out: LoadingCell) => {
    const cx = (bounds[at] + bounds[at + 3]) / 2,
      cz = (bounds[at + 2] + bounds[at + 5]) / 2
    const raw = (cx - eye[0]) ** 2 + (cz - eye[1]) ** 2
    let factor = 1
    if (pose.headed && streaming.angleWeight > 0) {
      const reach = radiusOf(range)
      origin[0] = eye[0]
      origin[1] = bounds[at + 1]
      origin[2] = eye[1]
      direction[0] = heading[0] * reach
      direction[2] = heading[1] * reach
      span[0] = 0
      span[1] = 1
      let angle = 0
      if (!slabCut(span, bounds, at, bounds, at + 3, origin, direction)) {
        let most = 0
        pointsX[0] = pointsX[1] = bounds[at]
        pointsX[2] = pointsX[3] = bounds[at + 3]
        pointsX[4] = cx
        pointsZ[0] = pointsZ[2] = bounds[at + 2]
        pointsZ[1] = pointsZ[3] = bounds[at + 5]
        pointsZ[4] = cz
        for (let k = 0; k < 5; k++) {
          toward(pointsX[k], pointsZ[k], point)
          most = Math.max(most, heading[0] * point[0] + heading[1] * point[1])
        }
        angle = Math.acos(clamp(most, -1, 1)) / Math.PI
      }
      factor = clamp(angle, DEG2RAD, 1) ** streaming.angleWeight
    }
    out.distance = raw * factor * factor
    out.raw = raw
    return out
  }
  /** `READ` as the last `set` saw them: what moves `revision` with the eye and the axis. */
  const seen = READ.map(() => NaN)
  let revision = 0
  /** Whether a setting `meets` reads changed since the last call; the settings now seen. */
  const settingsMoved = () => {
    let moved = false
    for (let at = 0; at < READ.length; at++) {
      const now = Number(streaming[READ[at]])
      moved ||= seen[at] !== now
      seen[at] = now
    }
    return moved
  }
  return {
    /** The view stands at `eye` looking along the unit `axis`, both in the cells' frame. */
    set(at: ArrayLike<number>, axis: ArrayLike<number>) {
      let moved = settingsMoved()
      for (let k = 0; k < 3; k++) {
        if (eye3[k] !== at[k] || axis3[k] !== axis[k]) moved = true
        eye3[k] = at[k]
        axis3[k] = axis[k]
      }
      if (moved) revision++
      eye[0] = at[0]
      eye[1] = at[2]
      const length = length2(axis[0], axis[2])
      pose.headed = length > 1e-9
      // A loose grid's sector keeps the axis as it is, its up part dropped; a square grid's turns
      // it to a unit heading on the ground.
      const scale = loose ? 1 : pose.headed ? 1 / length : 0
      heading[0] = axis[0] * scale
      heading[1] = axis[2] * scale
    },
    /** Advances whenever what `meets` reads moved at a `set`: the eye, the axis or a setting. What
     *  it said at one revision it says at the same revision again. */
    get revision() {
      return revision
    },
    /** The circle's radius for a grid of loading range `range`. */
    radius: radiusOf,
    /** Whether the shape turns with the view: a sector, the view headed or a grid not flat — what
     *  it meets then moves with the view's axis, the eye standing. */
    turns: () => (pose.headed || hlod.grids.some(({ flat }) => solid(flat))) && sectored(),
    /** Whether the view's shape for `grid` meets the bounds `bounds` at `at` stream by: within or
     *  on its radius in 3D and not outside its cone — a loose cell's content box on a grid that
     *  does not lie flat —; else on the ground within or on it — a loose cell's —, or strictly
     *  within it, and its content's height range meeting the eye's within it when the settings
     *  cull by height — a square cell's —, and not beside its sector. */
    meets(
      bounds: ArrayLike<number>,
      at: number,
      { range, flat }: Pick<PartitionGrid, 'range' | 'flat'>,
    ) {
      const radius = radiusOf(range)
      if (solid(flat)) return gapTo(bounds, at) <= radius * radius && !outsideCone(bounds, at)
      const away = boxGroundDistance(bounds, at, eye[0], eye[1])
      if (!(loose ? away <= radius : away < radius)) return false
      if (!loose && streaming.zCulling && beyondHeight(bounds, at, radius)) return false
      return !besideSector(bounds, at)
    },
    /** What ranks the bounds `bounds` at `at` stream by, of a grid of loading range `range`, by
     *  distance (`LoadingCell`), as the scheme says (`looseRanked`, `squareRanked`). */
    ranked(bounds: ArrayLike<number>, at: number, range: number, out: LoadingCell) {
      return loose ? looseRanked(bounds, at, range, out) : squareRanked(bounds, at, range, out)
    },
  }
}

export type StreamingSource = ReturnType<typeof createStreamingSource>
