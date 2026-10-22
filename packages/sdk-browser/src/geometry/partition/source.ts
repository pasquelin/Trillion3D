/**
 * THE VIEW AS THE STREAMING SOURCE OF A PARTITIONED SCENE, as the partition's scheme says
 * (`TablePartition.scheme`).
 *
 * The camera is the scene's one streaming source (`createStreamingSource`), its shape set by the
 * session's streaming settings (`WorldStreaming`, `WORLD_STREAMING_SETTINGS`): at its eye, seen
 * from above while the grids lie flat (`TablePartition.flat`), their up axis dropped, a circle of
 * each grid's own loading range scaled (`useGridRange`, `rangeScale`), or of one radius for every
 * grid (`radius`) — a sphere of it while they do not —; a sector of it around the view's axis when
 * the settings ask one (`sector`, `sectorAngle`). A cell is wished while that shape meets the
 * bounds it streams by (`meets`), and, a sector, not wholly beside or behind it: on `hashSet`'s
 * loose grids, the box around its content within or on the circle, the sector around the view's own
 * axis without its up part — or within or on the sphere, the sector a cone around the view's axis
 * that the box's bounding sphere meets —; on `spatialHash`'s square grids, its square strictly
 * within the circle, the sector around the view's unit heading on the ground, and, when the
 * settings cull by height (`zCulling`), its content's height range meeting the eye's within the
 * radius.
 *
 * What ranks the cells wished and not loaded by distance (`ranked`) is the scheme's too: the
 * order they load in, and how many load at once, are `loadOrder.ts`'s and `loadSlots.ts`'s.
 *
 * Cost: O(1) per cell tested or ranked.
 */
import { DEG2RAD } from '../../../../math/src/constants.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { cross2, length2 } from '../../../../math/src/vector/vector.ts'
import { boxGroundDistance } from '../../../../math/src/geometry/boxDistance.ts'
import { slabCut } from '../../../../math/src/geometry/slab.ts'
import type { WorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { TablePartition } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import type { LoadingCell } from './loadOrder.ts'

/**
 * The view as the source for a partition of `scheme` whose grids lie `flat` or not, under the
 * settings `streaming` holds as they stand — read at each test, so a setting changed takes from
 * the next frame —, set each frame (`set`): its eye and the unit axis of its view, both in the
 * cells' frame. A flat loose grid's sector turns around that axis with its up part dropped,
 * unscaled; one that does not lie flat around the axis itself; a square grid's around its unit
 * heading on the ground, glTF's `+Y` up dropped. A view looking straight down has no heading: a
 * square grid's sector is then the whole circle, and no angle weighs a cell's turn.
 */
export function createStreamingSource(
  streaming: WorldStreaming,
  { scheme, flat }: Pick<TablePartition, 'scheme' | 'flat'>,
) {
  const loose = scheme === 'hashSet',
    solid = loose && !flat
  const eye = [0, 0],
    heading = [0, 0],
    eye3 = [0, 0, 0],
    axis3 = [0, 0, 0]
  let headed = false
  /** The circle's radius for a grid of loading range `range`. */
  const radiusOf = (range: number) =>
    streaming.useGridRange ? range * streaming.rangeScale : streaming.radius
  /** The unit vector from the eye to `(x, z)`, zero at the eye. */
  const toward = (x: number, z: number, out: number[]) => {
    const dx = x - eye[0],
      dz = z - eye[1],
      length = length2(dx, dz)
    out[0] = length > 0 ? dx / length : 0
    out[1] = length > 0 ? dz / length : 0
    return out
  }
  const corner = [0, 0]
  /** The four corners of a box on the ground, and the sine and cosine of each one's angle to the
   *  heading: scratch of `besideSector`. */
  const cornersX = new Float64Array(4),
    cornersZ = new Float64Array(4),
    sines = new Float64Array(4),
    cosines = new Float64Array(4)
  /** Whether the shape is a sector: one asked, short of a whole turn. */
  const sectored = () => streaming.sector && streaming.sectorAngle < 360
  /** Whether the sector of `streaming.sectorAngle` around the heading on the ground (`heading`),
   *  when the shape is one, misses `bounds` at `at` beside or behind it, its four corners all
   *  out. A square grid's sector is the whole circle for a view with no heading; a loose grid's
   *  axis without its up part weighs every test as it is, however short. */
  const besideSector = (bounds: ArrayLike<number>, at: number) => {
    const angle = streaming.sectorAngle
    if ((!loose && !headed) || !sectored()) return false
    cornersX[0] = cornersX[3] = bounds[at]
    cornersX[1] = cornersX[2] = bounds[at + 3]
    cornersZ[0] = cornersZ[1] = bounds[at + 2]
    cornersZ[2] = cornersZ[3] = bounds[at + 5]
    for (let k = 0; k < 4; k++) {
      toward(cornersX[k], cornersZ[k], corner)
      sines[k] = cross2(heading[0], heading[1], corner[0], corner[1])
      cosines[k] = heading[0] * corner[0] + heading[1] * corner[1]
    }
    // How many corners lie on each side: all four decide (a corner that is no number counts none).
    let left = 0,
      right = 0,
      behind = 0,
      ahead = 0,
      inGap = 0
    if (angle <= 180) {
      const half = Math.sin(angle * 0.5 * DEG2RAD)
      for (let k = 0; k < 4; k++) {
        if (sines[k] < -half) left++
        if (sines[k] > half) right++
        if (cosines[k] < 0) behind++
      }
      return left === 4 || right === 4 || behind === 4
    }
    for (let k = 0; k < 4; k++) if (cosines[k] >= 0) ahead++
    if (ahead > 0) return false
    // Past a half circle: out only within the gap the sector leaves behind the view.
    const gap = Math.sin((360 - angle) * 0.5 * DEG2RAD)
    for (let k = 0; k < 4; k++) if (-sines[k] > -gap && -sines[k] < gap) inGap++
    return inGap === 4
  }
  /** Whether the height range of the box `bounds` at `at` misses the eye's within `radius`. */
  const beyondHeight = (bounds: ArrayLike<number>, at: number, radius: number) =>
    bounds[at + 4] < eye3[1] - radius || bounds[at + 1] > eye3[1] + radius
  const gap = [0, 0, 0]
  /** The way from the box `bounds` at `at` to the eye in 3D, into `gap` — none from within or on
   *  it —, and its squared length. */
  const gapTo = (bounds: ArrayLike<number>, at: number) => {
    let squared = 0
    for (let k = 0; k < 3; k++) {
      gap[k] = eye3[k] - clamp(eye3[k], bounds[at + k], bounds[at + 3 + k])
      squared += gap[k] * gap[k]
    }
    return squared
  }
  /** Whether the sector, a cone around the view's axis in 3D, misses the box `bounds` at `at`
   *  the sphere meets: the box's bounding sphere outside the cone drawn back by its radius over
   *  the half angle's sine, or behind the eye past that radius. */
  const outsideCone = (bounds: ArrayLike<number>, at: number) => {
    if (!sectored()) return false
    const half = streaming.sectorAngle * 0.5 * DEG2RAD,
      sine = Math.sin(half),
      cosine = Math.cos(half)
    let extent = 0
    for (let k = 0; k < 3; k++) extent += ((bounds[at + 3 + k] - bounds[at + k]) / 2) ** 2
    const back = Math.sqrt(extent) / sine
    let squared = 0,
      along = 0
    for (let k = 0; k < 3; k++) {
      const d = (bounds[at + k] + bounds[at + 3 + k]) / 2 - (eye3[k] - back * axis3[k])
      squared += d * d
      along += axis3[k] * d
    }
    if (!(along > 0 && along * along >= squared * cosine * cosine)) return true
    squared = along = 0
    for (let k = 0; k < 3; k++) {
      const d = (bounds[at + k] + bounds[at + 3 + k]) / 2 - eye3[k]
      squared += d * d
      along -= axis3[k] * d
    }
    return along > 0 && along * along >= squared * sine * sine && squared > extent
  }
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
    if (headed && streaming.angleWeight > 0) {
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
  /** The settings `meets` reads, as the last `set` saw them: what moves `revision` with the eye and
   *  the axis. */
  let seenRange = false,
    seenScale = NaN,
    seenRadius = NaN,
    seenSector = false,
    seenAngle = NaN,
    seenHeight = false,
    revision = 0
  /** Whether a setting `meets` reads changed since the last call; the settings now seen. */
  const settingsMoved = () => {
    const moved =
      seenRange !== streaming.useGridRange ||
      seenScale !== streaming.rangeScale ||
      seenRadius !== streaming.radius ||
      seenSector !== streaming.sector ||
      seenAngle !== streaming.sectorAngle ||
      seenHeight !== streaming.zCulling
    seenRange = streaming.useGridRange
    seenScale = streaming.rangeScale
    seenRadius = streaming.radius
    seenSector = streaming.sector
    seenAngle = streaming.sectorAngle
    seenHeight = streaming.zCulling
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
      headed = length > 1e-9
      // A loose grid's sector keeps the axis as it is, its up part dropped; a square grid's turns
      // it to a unit heading on the ground.
      const scale = loose ? 1 : headed ? 1 / length : 0
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
    /** Whether the shape turns with the view: a sector, the view headed or its grids not flat —
     *  what it meets then moves with the view's axis, the eye standing. */
    turns: () => (headed || solid) && sectored(),
    /** Whether the view's shape for a grid of loading range `range` meets the bounds `bounds` at
     *  `at` stream by: within or on its radius in 3D and not outside its cone — a loose cell's
     *  content box on grids that do not lie flat —; else on the ground within or on it — a loose
     *  cell's —, or strictly within it, and its content's height range meeting the eye's within
     *  it when the settings cull by height — a square cell's —, and not beside its sector. */
    meets(bounds: ArrayLike<number>, at: number, range: number) {
      const radius = radiusOf(range)
      if (solid) return gapTo(bounds, at) <= radius * radius && !outsideCone(bounds, at)
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
