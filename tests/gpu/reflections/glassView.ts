// Where the eye and the panes of the glass proof stand, and the geometry it checks the image
// against (`glassPage.ts`): the eye's rays, a ray's crossing of a pane, a point's pixel.
import { DEG2RAD } from '../../../packages/math/src/constants.ts'
import { camera, type V3 } from '../../../packages/sdk-browser/src/reflections/boxes.fixture.ts'

export const WIDTH = 256,
  HEIGHT = 192
const FOV = 55 * DEG2RAD
export const EYE: V3 = [0, 2, 2.5],
  TARGET: V3 = [0.3, -0.2, -3.5]
const eye = camera(EYE, TARGET, WIDTH, HEIGHT, FOV)

/** The unit direction of the eye's ray through the centre of the pixel `(x, y)` (top row first). */
export const rayOf = (x: number, y: number) => eye.ray(x + 0.5, y + 0.5)

/** The point where the ray `o + t·d` crosses the square pane of `pane` (centre, half-side, yaw), and
 *  its distance `t`: the pane's plane and the pane's extent; `undefined` when it misses. */
export function crossing(o: V3, d: V3, { at, half, yaw }: { at: V3; half: number; yaw: number }) {
  const n: V3 = [Math.sin(yaw), 0, Math.cos(yaw)]
  const along = d[0] * n[0] + d[2] * n[2]
  if (Math.abs(along) < 1e-6) return undefined
  const t = ((at[0] - o[0]) * n[0] + (at[2] - o[2]) * n[2]) / along
  if (t <= 0) return undefined
  const p: V3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]
  const right: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)]
  const u = (p[0] - at[0]) * right[0] + (p[2] - at[2]) * right[2]
  const v = p[1] - at[1]
  return Math.abs(u) <= half && Math.abs(v) <= half ? { t, p } : undefined
}

/** The pixel (top row first, as an index, −1 off the image) where the world point `p` shows. */
export function pixelOf(p: V3) {
  const [px, py, , depth] = eye.project(p)
  if (depth <= 0) return -1
  return px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT
    ? -1
    : Math.floor(py) * WIDTH + Math.floor(px)
}

/** The mirror of `d` about the vertical pane of yaw `yaw`. */
export function mirror(d: V3, yaw: number): V3 {
  const n: V3 = [Math.sin(yaw), 0, Math.cos(yaw)]
  const dn = d[0] * n[0] + d[1] * n[1] + d[2] * n[2]
  return [d[0] - 2 * dn * n[0], d[1] - 2 * dn * n[1], d[2] - 2 * dn * n[2]]
}
