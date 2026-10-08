// The hot-path math of packages/math frozen: the oracles its optimised forms must
// match bit for bit (`bench/witnesses/three/parity/core/math/primitives/{cone,coneDevelop,box}.test.ts`,
// `bench/witnesses/three/parity/core/math/frustum/box.test.ts`), with the seeded inputs they are fed.
import { xorshiftRandom } from '../../core/measure.ts'
import { HOSTILE_FLOATS } from '../../../tests/kit/assert/hostile.ts'
import { coneRejects } from '../../../packages/math/src/projection/projectionOracles.ts'
import { length3 } from '../../../packages/math/src/vector/vector.ts'
import {
  boxCornersInto,
  boxEmpty,
  boxExpandByPoint,
} from '../../../packages/math/src/geometry/box.ts'

/** Seeded floats: one in eight hostile or maximal, the others of every sign and scale. */
export function hostileFloats(seed: number) {
  const next = xorshiftRandom(seed)
  const rare = [...HOSTILE_FLOATS, Number.MAX_VALUE, -Number.MAX_VALUE]
  return (scale = 10) =>
    next() < 0.125
      ? rare[Math.floor(next() * rare.length)]
      : (next() - 0.5) * scale * 10 ** Math.floor(next() * 3 - 1)
}

/**
 * Seeded cone cases, one in two hostile throughout; the other grazing: an identity placement and
 * an axis nearly across the view, `toward` a hair on either side of 0, under a cone angle down
 * to 1e-9, where the early exit and the full verdict are closest.
 */
export function coneCases(seed: number) {
  const f = hostileFloats(seed)
  const next = xorshiftRandom(seed + 1)
  const at = (n: number, scale?: number) => Array.from({ length: n }, () => f(scale))
  return (i: number) => {
    if (i % 2 === 0) {
      const [min, extent] = [at(3), at(3)]
      return {
        axis: at(3),
        angle: Math.abs(f(1)),
        min,
        max: min.map((v, k) => v + Math.abs(extent[k])),
        world: [...at(3), 0, ...at(3), 0, ...at(3), 0, ...at(4, 100)],
        normal: at(9),
        scale: Math.abs(f(2)),
        eye: [...at(3, 1000), i % 4 ? 1 : 0],
      }
    }
    const t = at(3, 100).map((v) => (Number.isFinite(v) && Math.abs(v) < 1e300 ? v : 1))
    const eye = [(next() - 0.5) * 1000, (next() - 0.5) * 1000, (next() - 0.5) * 1000, 1]
    const [vx, vy, vz] = [eye[0] - t[0], eye[1] - t[1], eye[2] - t[2]]
    const [rx, ry, rz] = [next() - 0.5, next() - 0.5, next() - 0.5]
    const lean = (next() - 0.5) * 10 ** -Math.floor(next() * 10) * Math.hypot(rx, ry, rz)
    return {
      axis: [
        vy * rz - vz * ry - lean * vx,
        vz * rx - vx * rz - lean * vy,
        vx * ry - vy * rx - lean * vz,
      ],
      angle: 10 ** -Math.floor(next() * 10),
      min: [-1e-6, -1e-6, -1e-6],
      max: [1e-6, 1e-6, 1e-6],
      world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1],
      normal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      scale: 1,
      eye,
    }
  }
}

/** The lengths a cone oracle pays: `length` for the box radius, the eye distance and the view
 *  vector, `axisLength` for the turned cone axis. */
type ConeLengths = Record<'length' | 'axisLength', (x: number, y: number, z: number) => number>

/** The length rule's: `length3` throughout. */
const RULE_LENGTHS: ConeLengths = { length: length3, axisLength: length3 }

/** Develop's before the length rule: `Math.hypot`, the axis by the plain root of its squares. */
export const HYPOT_LENGTHS: ConeLengths = {
  length: (x, y, z) => Math.hypot(x, y, z),
  axisLength: (x, y, z) => Math.sqrt(x * x + y * y + z * z),
}

/** `boxConeRejects` unoptimised: every length paid, by `lengths`, then the verdict. */
export function boxConeRejectsBefore(
  axis: ArrayLike<number>,
  angle: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
  e: ArrayLike<number>,
  normal: ArrayLike<number>,
  scale: number,
  eye: ArrayLike<number>,
  { length, axisLength }: ConeLengths = RULE_LENGTHS,
) {
  const lx = (min[0] + max[0]) * 0.5,
    ly = (min[1] + max[1]) * 0.5,
    lz = (min[2] + max[2]) * 0.5
  const w = 1 / (e[3] * lx + e[7] * ly + e[11] * lz + e[15])
  const cx = (e[0] * lx + e[4] * ly + e[8] * lz + e[12]) * w,
    cy = (e[1] * lx + e[5] * ly + e[9] * lz + e[13]) * w,
    cz = (e[2] * lx + e[6] * ly + e[10] * lz + e[14]) * w
  const radius =
    length((max[0] - min[0]) * 0.5, (max[1] - min[1]) * 0.5, (max[2] - min[2]) * 0.5) * scale
  const px = eye[0],
    py = eye[1],
    pz = eye[2],
    pw = eye[3]
  const d = length(px - cx * pw, py - cy * pw, pz - cz * pw)
  const t = (radius * pw) / d
  const spread = !(d > radius * pw) ? Math.PI : Math.asin(t < 0 ? 0 : t > 1 ? 1 : t)
  const a0 = axis[0],
    a1 = axis[1],
    a2 = axis[2]
  let ax = normal[0] * a0 + normal[3] * a1 + normal[6] * a2,
    ay = normal[1] * a0 + normal[4] * a1 + normal[7] * a2,
    az = normal[2] * a0 + normal[5] * a1 + normal[8] * a2
  const al = axisLength(ax, ay, az)
  if (!(al > 0)) return false
  const inverse = 1 / al
  ax *= inverse
  ay *= inverse
  az *= inverse
  const vx = px - cx * pw,
    vy = py - cy * pw,
    vz = pz - cz * pw
  const vl = length(vx, vy, vz)
  if (!(vl > 0)) return false
  const dot = Math.min(1, Math.max(-1, (ax * vx + ay * vy + az * vz) / vl))
  try {
    return coneRejects(dot, angle, spread)
  } catch {
    return false
  }
}

/** `frustumClipBox` unoptimised: the bounds stored in an array the plane's sign indexes. */
export function frustumClipBoxBefore(planes: ArrayLike<number>, box: ArrayLike<number>) {
  const bounds = [box[0], box[3], box[1], box[4], box[2], box[5]]
  const side = (p: number, forward: number) => {
    const a = planes[p],
      b = planes[p + 1],
      c = planes[p + 2]
    const f = (s: number) => (s > 0 ? forward : 1 - forward)
    return a * bounds[f(a)] + b * bounds[2 + f(b)] + c * bounds[4 + f(c)] + planes[p + 3] < 0
  }
  for (let p = 0; p < 24; p += 4) if (side(p, 1)) return 0
  for (let p = 0; p < 24; p += 4) if (side(p, 0)) return 1
  return 2
}

/** `boxTransform` unoptimised on a non-empty box: the corners written out, then folded. */
export function boxTransformBefore(box: ArrayLike<number>, m: ArrayLike<number>) {
  const corners = new Float64Array(24),
    out = new Float64Array(6)
  boxCornersInto(corners, 0, box[0], box[1], box[2], box[3], box[4], box[5], m)
  boxEmpty(out, 0)
  for (let at = 0; at < 24; at += 3)
    boxExpandByPoint(out, 0, corners[at], corners[at + 1], corners[at + 2])
  return out
}
