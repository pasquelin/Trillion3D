/**
 * THE TESTS OF THE VIEW'S SHAPE (`source.ts`): whether a sector — the view's axis and an angle —
 * and a circle's height cull miss the bounds a cell streams by, on the ground or in 3D.
 *
 * The view's pose is the source's (`ViewPose`): its eye and heading on the ground, its eye and axis
 * in 3D, and whether it has a heading. A sector's angle is its own with the extra angle added, a
 * whole turn at most (`angleOf`); on the ground a box is beside it when its four corners all lie
 * to one side or behind (`besideSector`), in 3D the sector is a cone the box's bounding sphere
 * must meet (`outsideCone`); the distance from the eye to a box is `gapTo`. A shape whose radius
 * or angle is nearly zero is no shape (`valid`): it meets nothing. A view looking straight up or
 * down heads where its up vector points (`aimOf`).
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

/** The reference's tolerance for a radius or an angle taken as zero, 1e-8 centimetres in metres. */
const NEARLY_ZERO = 1e-10
/** The length of a view's axis on the ground under which it has no heading. */
export const NO_HEADING = 1e-9

/** The direction `axis` heads on the ground, given the camera's `up`: the axis itself, or — one
 *  looking straight down or up, no length of it on the ground — the ground part of `up`, as it
 *  points ahead looking down and behind looking up, into `out`. */
export function aimOf(axis: ArrayLike<number>, up: ArrayLike<number>, out: number[]) {
  if (length2(axis[0], axis[2]) > NO_HEADING || !(length2(up[0], up[2]) > NO_HEADING)) return axis
  const ahead = axis[1] < 0 ? 1 : -1
  out[0] = ahead * up[0]
  out[1] = 0
  out[2] = ahead * up[2]
  return out
}

/** The unit vector from the eye of `pose` to `(x, z)`, zero at the eye. */
function toward(pose: ViewPose, x: number, z: number, out: number[]) {
  const dx = x - pose.eye[0],
    dz = z - pose.eye[1],
    length = length2(dx, dz)
  out[0] = length > 0 ? dx / length : 0
  out[1] = length > 0 ? dz / length : 0
  return out
}

const corner = [0, 0]
/** The four corners of a box on the ground, and the sine and cosine of each one's angle to the
 *  heading: scratch of `sectorMisses`. */
const cornersX = new Float64Array(4),
  cornersZ = new Float64Array(4),
  sines = new Float64Array(4),
  cosines = new Float64Array(4)

/** Whether the sector of `angle` around the heading on the ground misses the box `bounds` at `at`,
 *  beside or behind it: its four corners all out. */
function sectorMisses(pose: ViewPose, angle: number, bounds: ArrayLike<number>, at: number) {
  const { heading } = pose
  cornersX[0] = cornersX[3] = bounds[at]
  cornersX[1] = cornersX[2] = bounds[at + 3]
  cornersZ[0] = cornersZ[1] = bounds[at + 2]
  cornersZ[2] = cornersZ[3] = bounds[at + 5]
  for (let k = 0; k < 4; k++) {
    toward(pose, cornersX[k], cornersZ[k], corner)
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

/** The way from the box `bounds` at `at` to `eye` in 3D, into `gap` — none from within or on it —,
 *  and its squared length. */
function gapInto(gap: number[], eye: number[], bounds: ArrayLike<number>, at: number) {
  let squared = 0
  for (let k = 0; k < 3; k++) {
    gap[k] = eye[k] - clamp(eye[k], bounds[at + k], bounds[at + 3 + k])
    squared += gap[k] * gap[k]
  }
  return squared
}

/** Whether the cone of `angle` around the view's axis in 3D misses the box `bounds` at `at` the
 *  sphere meets: the box's bounding sphere outside the cone drawn back by its radius over the half
 *  angle's sine, or behind the eye past that radius. */
function coneMisses(pose: ViewPose, angle: number, bounds: ArrayLike<number>, at: number) {
  const { eye3, axis3 } = pose
  const half = angle * 0.5 * DEG2RAD,
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

/** The shape tests of the view `pose` under the settings `streaming` holds as they stand, for a
 *  partition whose grids are `loose` (`hashSet`) or square. */
export function createSourceShape(streaming: WorldStreaming, loose: boolean, pose: ViewPose) {
  const gap = [0, 0, 0]
  /** The sector's angle: its own, its extra angle added, a whole turn at most; a whole turn when
   *  none is asked. */
  const angleOf = () =>
    streaming.sector ? Math.min(streaming.sectorAngle + streaming.extraAngle, 360) : 360
  /** Whether the shape is a sector: one asked, short of a whole turn. */
  const sectored = () => angleOf() < 360
  return {
    toward: (x: number, z: number, out: number[]) => toward(pose, x, z, out),
    sectored,
    /** Whether a shape of `radius` is one: neither its radius nor its angle nearly zero. */
    valid: (radius: number) => radius > NEARLY_ZERO && angleOf() > NEARLY_ZERO,
    /** Whether the sector around the heading on the ground, when the shape is one, misses `bounds`
     *  at `at`. A square grid's sector is the whole circle for a view with no heading; a loose
     *  grid's axis without its up part weighs every test as it is, however short. */
    besideSector: (bounds: ArrayLike<number>, at: number) =>
      sectored() && (loose || pose.headed) && sectorMisses(pose, angleOf(), bounds, at),
    /** Whether the height range of the box `bounds` at `at` misses the eye's within `radius`. */
    beyondHeight: (bounds: ArrayLike<number>, at: number, radius: number) =>
      bounds[at + 4] < pose.eye3[1] - radius || bounds[at + 1] > pose.eye3[1] + radius,
    gap,
    gapTo: (bounds: ArrayLike<number>, at: number) => gapInto(gap, pose.eye3, bounds, at),
    outsideCone: (bounds: ArrayLike<number>, at: number) =>
      sectored() && coneMisses(pose, angleOf(), bounds, at),
  }
}
