// Where the eye and the panes of the glass proof stand, and the geometry it checks the image
// against (`glassPage.ts`): the eye's rays, a ray's crossing of a pane, a point's pixel.
import { DEG2RAD } from '../../../packages/math/src/constants.ts'
import { length3 } from '../../../packages/math/src/vector/vector.ts'

export const WIDTH = 256,
  HEIGHT = 192
export type V3 = [number, number, number]
export const EYE: V3 = [0, 2, 2.5],
  TARGET: V3 = [0.3, -0.2, -3.5]
const unit = (v: V3): V3 => {
  const length = length3(v[0], v[1], v[2])
  return [v[0] / length, v[1] / length, v[2] / length]
}

/** The eye's axes: forward, right and up. */
const BASIS = (() => {
  const f = unit(TARGET.map((v, k) => v - EYE[k]) as V3)
  const right = unit([-f[2], 0, f[0]])
  const up: V3 = [
    right[1] * f[2] - right[2] * f[1],
    right[2] * f[0] - right[0] * f[2],
    right[0] * f[1] - right[1] * f[0],
  ]
  return { f, right, up }
})()

/** The unit direction of the eye's ray through the centre of the pixel `(x, y)` (top row first). */
export function rayOf(x: number, y: number): V3 {
  const { f, right, up } = BASIS
  const tan = Math.tan((55 / 2) * DEG2RAD)
  const u = (((x + 0.5) / WIDTH) * 2 - 1) * tan * (WIDTH / HEIGHT)
  const v = (1 - ((y + 0.5) / HEIGHT) * 2) * tan
  return unit([0, 1, 2].map((k) => f[k] + right[k] * u + up[k] * v) as V3)
}

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
  const { f, right, up } = BASIS
  const v = p.map((c, k) => c - EYE[k])
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const tan = Math.tan((55 / 2) * DEG2RAD)
  const depth = dot(v, f)
  if (depth <= 0) return -1
  const x = ((dot(v, right) / (depth * tan * (WIDTH / HEIGHT))) * 0.5 + 0.5) * WIDTH
  const y = (0.5 - (dot(v, up) / (depth * tan)) * 0.5) * HEIGHT
  return x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT ? -1 : Math.floor(y) * WIDTH + Math.floor(x)
}

/** The mirror of `d` about the vertical pane of yaw `yaw`. */
export function mirror(d: V3, yaw: number): V3 {
  const n: V3 = [Math.sin(yaw), 0, Math.cos(yaw)]
  const dn = d[0] * n[0] + d[1] * n[1] + d[2] * n[2]
  return [d[0] - 2 * dn * n[0], d[1] - 2 * dn * n[1], d[2] - 2 * dn * n[2]]
}
