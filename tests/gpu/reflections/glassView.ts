// Where the eye and the panes of the glass proof stand, and the geometry it checks the image
// against (`glassPage.ts`): the eye's rays, a ray's crossing of a pane, a point's pixel.
import { DEG2RAD } from '../../../packages/math/src/constants.ts'
import { camera } from '../../../packages/sdk-browser/src/reflections/boxes.fixture.ts'
import { reflect, type Vec3 } from '../../../packages/math/src/vector/vectorTuple.ts'
import { rayRectangle } from '../../../packages/math/src/geometry/rayShapes.ts'

export const WIDTH = 256,
  HEIGHT = 192
/** The eye's vertical field of view, in degrees, and its near plane: the engine camera's and the
 *  analytic eye's. */
export const FOV_DEGREES = 55,
  NEAR = 0.1
export const EYE: Vec3 = [0, 2, 2.5],
  TARGET: Vec3 = [0.3, -0.2, -3.5]
const eye = camera(EYE, TARGET, WIDTH, HEIGHT, FOV_DEGREES * DEG2RAD, NEAR)

/** The unit direction of the eye's ray through the centre of the pixel `(x, y)` (top row first). */
export const rayOf = (x: number, y: number) => eye.ray(x + 0.5, y + 0.5)

/** The point where the ray `o + t·d` crosses the square pane of `pane` (centre, half-side, yaw), and
 *  its distance `t`: the pane's plane and the pane's extent; `undefined` when it misses. */
export function crossing(
  o: Vec3,
  d: Vec3,
  { at, half, yaw }: { at: Vec3; half: number; yaw: number },
) {
  const n: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)],
    right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)]
  const t = rayRectangle(o, d, at, n, right, [0, 1, 0], half, half)
  if (!(t > 0)) return undefined
  const p: Vec3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]
  return { t, p }
}

/** The pixel (top row first, as an index, −1 off the image) where the world point `p` shows. */
export function pixelOf(p: Vec3) {
  const [px, py, , depth] = eye.project(p)
  if (depth <= 0) return -1
  return px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT
    ? -1
    : Math.floor(py) * WIDTH + Math.floor(px)
}

/** The mirror of `d` about the vertical pane of yaw `yaw`. */
export function mirror(d: Vec3, yaw: number): Vec3 {
  return reflect(d, [Math.sin(yaw), 0, Math.cos(yaw)])
}
