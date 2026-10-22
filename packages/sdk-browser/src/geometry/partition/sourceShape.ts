/**
 * THE TESTS OF THE VIEW'S SHAPE (`source.ts`): whether a sector — the view's axis and an angle —
 * and a circle's height cull miss the bounds a cell streams by, on the ground or in 3D.
 *
 * The view's pose is the source's (`ViewPose`): its eye and heading on the ground, its eye and axis
 * in 3D, and whether it has a heading. A sector's angle is its own with the extra angle added, a
 * whole turn at most (`angleOf`); on the ground a box is beside it when its four corners all lie
 * to one side or behind (`besideSector`), in 3D the sector is a cone the box's bounding sphere
 * must meet (`outsideCone`); the distance from the eye to a box is `gapTo`.
 *
 * Cost: O(1) per box tested.
 */
import { DEG2RAD } from '../../../../math/src/constants.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { cross2, length2 } from '../../../../math/src/vector/vector.ts'
import type { WorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'

/** Where the view stands, as the source sets it each frame: its eye on the ground (`x`, `z`) and
 *  its heading there, its eye and unit axis in 3D, and whether it has a heading. */
export type ViewPose = {
  eye: number[]
  heading: number[]
  eye3: number[]
  axis3: number[]
  headed: boolean
}

/** The shape tests of the view `pose` under the settings `streaming` holds as they stand, for a
 *  partition whose grids are `loose` (`hashSet`) or square. */
export function createSourceShape(streaming: WorldStreaming, loose: boolean, pose: ViewPose) {
  const { eye, heading, eye3, axis3 } = pose
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
  /** The sector's angle: its own, its extra angle added, a whole turn at most; a whole turn when
   *  none is asked. */
  const angleOf = () =>
    streaming.sector ? Math.min(streaming.sectorAngle + streaming.extraAngle, 360) : 360
  /** Whether the shape is a sector: one asked, short of a whole turn. */
  const sectored = () => angleOf() < 360
  /** Whether the sector of `angleOf()` around the heading on the ground (`heading`),
   *  when the shape is one, misses `bounds` at `at` beside or behind it, its four corners all
   *  out. A square grid's sector is the whole circle for a view with no heading; a loose grid's
   *  axis without its up part weighs every test as it is, however short. */
  const besideSector = (bounds: ArrayLike<number>, at: number) => {
    const angle = angleOf()
    if ((!loose && !pose.headed) || !sectored()) return false
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
    const half = angleOf() * 0.5 * DEG2RAD,
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
  return { toward, sectored, besideSector, beyondHeight, gap, gapTo, outsideCone }
}
