/**
 * Unit quaternions on flat numbers, `(x, y, z, w)`: the rotation arithmetic the camera
 * controllers and the scene objects share. No allocation beyond the caller's buffers.
 */
import { hypot4 } from '../float/hypot.ts'
import { fdlibmAcos, fdlibmSin } from '../float/trig.ts'
import type { NumberSink } from '../matrix/matrix4.ts'
import { NORMAL_SQUARES } from '../vector/vector.ts'

/** Quaternion of a rotation of `angle` radians about a unit axis. */
export function axisAngleQuaternion(out: Float64Array, axis: ArrayLike<number>, angle: number) {
  const half = Math.sin(angle / 2)
  out[0] = axis[0] * half
  out[1] = axis[1] * half
  out[2] = axis[2] * half
  out[3] = Math.cos(angle / 2)
  return out
}

/**
 * The orientation of a camera turned by `yaw` about world +Y, then by `pitch` about its own X:
 * `(cy·sx, sy·cx, −sy·sx, cy·cx)` of the half-angle sines and cosines — the product of the two
 * axis-angle quaternions, yaw first, its zero terms left out. Both zero: the identity, looking
 * down −Z.
 */
export function yawPitchQuaternion(out: Float64Array, yaw: number, pitch: number) {
  const halfYaw = yaw / 2,
    halfPitch = pitch / 2
  const sy = Math.sin(halfYaw),
    cy = Math.cos(halfYaw),
    sx = Math.sin(halfPitch),
    cx = Math.cos(halfPitch)
  out[0] = cy * sx
  out[1] = sy * cx
  out[2] = -sy * sx
  out[3] = cy * cx
  return out
}

/** `out = a · b`, the rotation of `b` followed by that of `a`; `out` may alias `a` or `b`. */
export function multiplyQuaternion(out: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>) {
  const ax = a[0],
    ay = a[1],
    az = a[2],
    aw = a[3],
    bx = b[0],
    by = b[1],
    bz = b[2],
    bw = b[3]
  out[0] = aw * bx + ax * bw + ay * bz - az * by
  out[1] = aw * by - ax * bz + ay * bw + az * bx
  out[2] = aw * bz + ax * by - ay * bx + az * bw
  out[3] = aw * bw - ax * bx - ay * by - az * bz
  return out
}

/** `a ⊗ b` like `multiplyQuaternion`, its sums in the other order: the vector part
 *  `a.xyz·b.w + a.w·b.xyz + a.xyz × b.xyz`, the scalar `a.w·b.w − a.xyz·b.xyz`, each left to right.
 *  x and w round as `multiplyQuaternion`'s, y and z can differ in the last bit: `lookAtNode`'s aim
 *  is held to this order. `out` may alias `a` or `b`. */
export function multiplyQuaternionVectorFirst(
  out: Float64Array,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
) {
  const ax = a[0],
    ay = a[1],
    az = a[2],
    aw = a[3],
    bx = b[0],
    by = b[1],
    bz = b[2],
    bw = b[3]
  out[0] = ax * bw + aw * bx + ay * bz - az * by
  out[1] = ay * bw + aw * by + az * bx - ax * bz
  out[2] = az * bw + aw * bz + ax * by - ay * bx
  out[3] = aw * bw - ax * bx - ay * by - az * bz
  return out
}

/** `a · b` on the four components read at `aAt` and `bAt`, summed `x, y, z, w` left to right. */
export function dotQuaternion(a: ArrayLike<number>, b: ArrayLike<number>, aAt = 0, bAt = 0) {
  return (
    a[aAt] * b[bAt] + a[aAt + 1] * b[bAt + 1] + a[aAt + 2] * b[bAt + 2] + a[aAt + 3] * b[bAt + 3]
  )
}

/** The squared distance of the four-vectors at `a[aAt]` and `b[bAt]`: the squares of `a − b`,
 *  component by component, summed `x, y, z, w` left to right (`distanceSqVector3` on four). */
export function distanceSqQuaternion(a: ArrayLike<number>, b: ArrayLike<number>, aAt = 0, bAt = 0) {
  const dx = a[aAt] - b[bAt],
    dy = a[aAt + 1] - b[bAt + 1],
    dz = a[aAt + 2] - b[bAt + 2],
    dw = a[aAt + 3] - b[bAt + 3]
  return dx * dx + dy * dy + dz * dz + dw * dw
}

/** The length of the quaternion at `at`: the root of `dotQuaternion(q, q)` in the normal band of
 *  `length3`, `hypot4` outside it — the rule of `length3` on four terms. `normalizeQuaternion`
 *  keeps its own, the sampler twin's. */
export function lengthQuaternion(q: ArrayLike<number>, at = 0) {
  const s = dotQuaternion(q, q, at, at)
  return s < NORMAL_SQUARES || s === Infinity
    ? hypot4(q[at], q[at + 1], q[at + 2], q[at + 3])
    : Math.sqrt(s)
}

/** `out` at `outAt` = the conjugate `(−x, −y, −z, w)` of the quaternion at `q[qAt]`, the inverse
 *  turn of a unit one. The four are read before the first write, so `out` may be `q`. */
export function conjugateQuaternion<T extends NumberSink>(
  out: T,
  q: ArrayLike<number>,
  outAt = 0,
  qAt = 0,
) {
  const x = q[qAt],
    y = q[qAt + 1],
    z = q[qAt + 2],
    w = q[qAt + 3]
  out[outAt] = -x
  out[outAt + 1] = -y
  out[outAt + 2] = -z
  out[outAt + 3] = w
  return out
}

/** The angle in radians between the turns of two unit quaternions, `q` and `−q` alike:
 *  `2 · acos(min(1, |a · b|))`. */
export function quaternionAngle(a: ArrayLike<number>, b: ArrayLike<number>, aAt = 0, bAt = 0) {
  return 2 * Math.acos(Math.min(1, Math.abs(dotQuaternion(a, b, aAt, bAt))))
}

/** The squared lengths between which the four squares are summed unscaled: no square overflows,
 *  and one too small to count is below 2^-1074 of the sum. */
const SQUARED_MIN = 2 ** -900,
  SQUARED_MAX = 2 ** 900

/**
 * Rescales a quaternion to unit length, so a chain of small rotations cannot drift. The length is
 * the square root of the four squares summed as `hypot4` sums them (Kahan), without its scaling by
 * the largest magnitude: within `SQUARED_MIN`..`SQUARED_MAX` that scaling only adds roundings —
 * four divisions in and one product out. Against the exact `q / |q|`, no worse than the scaled
 * length on any input family measured and better on most (maximum 2.7 → 2.3 ULP, mean 0.73 → 0.64
 * on near-unit quaternions), and four divisions cheaper. Outside that range — zero, a NaN, an
 * infinity, magnitudes near the limits — the length is `hypot4`'s.
 */
export function normalizeQuaternion(q: Float64Array) {
  return normalizeQuaternionAt(q, 0, q[0], q[1], q[2], q[3])
}

/** `(x, y, z, w)` scaled to unit length as `normalizeQuaternion` scales it, written into `out` at
 *  `at`: for a caller holding many quaternions in one flat array. */
export function normalizeQuaternionAt(
  out: Float64Array,
  at: number,
  x: number,
  y: number,
  z: number,
  w: number,
) {
  const sum = x * x + y * y,
    compensation = sum - x * x - y * y,
    summand = z * z - compensation,
    third = sum + summand,
    squared = third + (w * w - (third - sum - summand))
  const length =
    squared >= SQUARED_MIN && squared <= SQUARED_MAX ? Math.sqrt(squared) : hypot4(x, y, z, w) || 1
  out[at] = x / length
  out[at + 1] = y / length
  out[at + 2] = z / length
  out[at + 3] = w / length
  return out
}

/**
 * The quaternion at `q[qAt]` turned at angular velocity `w` (radians per unit time, world axes, read
 * at `wAt`) for the half step `h` — half the time — into `out` at `outAt`: one explicit step of
 * `q̇ = ½ (ω, 0) ⊗ q`, `q + h · (ω, 0) ⊗ q`, each term summed in a fixed order, then made unit by
 * `normalizeQuaternionAt`. `out` may be `q`: the eight numbers are read before the write.
 */
export function turnByAngularVelocity(
  out: Float64Array,
  outAt: number,
  q: ArrayLike<number>,
  qAt: number,
  w: ArrayLike<number>,
  wAt: number,
  h: number,
) {
  const wx = w[wAt],
    wy = w[wAt + 1],
    wz = w[wAt + 2]
  const tx = q[qAt],
    ty = q[qAt + 1],
    tz = q[qAt + 2],
    tw = q[qAt + 3]
  return normalizeQuaternionAt(
    out,
    outAt,
    tx + h * (wx * tw + wy * tz - wz * ty),
    ty + h * (wy * tw + wz * tx - wx * tz),
    tz + h * (wz * tw + wx * ty - wy * tx),
    tw - h * (wx * tx + wy * ty + wz * tz),
  )
}

/** The arc `slerpQuaternion` follows, rewritten per call. */
const arcOf = new Float64Array(3)

/**
 * `out` = the spherical interpolation from the quaternion at `a[ai]` to the one at `b[bi]`, a
 * fraction `t` of the way along the shorter arc; `out` may alias either. Returns whether the two
 * were nearly aligned: the arc is then a line, and `out`, the lerp, is exact to rounding once
 * normalised, which the caller does.
 */
export function slerpQuaternion(
  out: Float64Array,
  a: ArrayLike<number>,
  ai: number,
  b: ArrayLike<number>,
  bi: number,
  t: number,
) {
  return slerpOnArc(out, 0, a, ai, b, bi, t, slerpArc(arcOf, 0, a, ai, b, bi), 0)
}

/**
 * The arc of a slerp from the quaternion at `a[ai]` to the one at `b[bi]`, into `arc` at `at`: the
 * side (`1`, or `-1` to go the shorter way, to `-b`), the angle and its sine. It depends on the
 * two quaternions alone: a caller sampling between the same two keys several times keeps it. The
 * arc cosine and the sine are fdlibm's (`../float/trig.ts`): the same bits on every machine
 * and in the WebAssembly sampler (`packages/page-codec-wasm/src/anim.rs`).
 */
export function slerpArc(
  arc: Float64Array,
  at: number,
  a: ArrayLike<number>,
  ai: number,
  b: ArrayLike<number>,
  bi: number,
) {
  let cos = dotQuaternion(a, b, ai, bi)
  const sign = cos < 0 ? -1 : 1
  cos *= sign
  const angle = fdlibmAcos(Math.min(1, cos))
  arc[at] = sign
  arc[at + 1] = angle
  arc[at + 2] = fdlibmSin(angle)
  return arc
}

/** `slerpQuaternion` into `out` at `outAt`, along the arc at `arc[arcAt]`, the `slerpArc` of the
 *  same two quaternions. */
export function slerpOnArc(
  out: Float64Array,
  outAt: number,
  a: ArrayLike<number>,
  ai: number,
  b: ArrayLike<number>,
  bi: number,
  t: number,
  arc: Float64Array,
  arcAt: number,
) {
  const x = a[ai],
    y = a[ai + 1],
    z = a[ai + 2],
    w = a[ai + 3],
    qx = b[bi],
    qy = b[bi + 1],
    qz = b[bi + 2],
    qw = b[bi + 3]
  const sign = arc[arcAt],
    angle = arc[arcAt + 1],
    sin = arc[arcAt + 2],
    line = sin < 1e-6,
    wa = line ? 1 - t : fdlibmSin((1 - t) * angle) / sin,
    wb = line ? t * sign : (fdlibmSin(t * angle) / sin) * sign
  out[outAt] = x * wa + qx * wb
  out[outAt + 1] = y * wa + qy * wb
  out[outAt + 2] = z * wa + qz * wb
  out[outAt + 3] = w * wa + qw * wb
  return line
}

/** Rotates `(x, y, z)` by the unit quaternion `q`. */
export function rotateByQuaternion(
  out: Float64Array,
  q: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
) {
  const tx = 2 * (q[1] * z - q[2] * y),
    ty = 2 * (q[2] * x - q[0] * z),
    tz = 2 * (q[0] * y - q[1] * x)
  out[0] = x + q[3] * tx + q[1] * tz - q[2] * ty
  out[1] = y + q[3] * ty + q[2] * tx - q[0] * tz
  out[2] = z + q[3] * tz + q[0] * ty - q[1] * tx
  return out
}

/** Sign of the second product in each of `x, y, z, w`, by the order the three turns compose in. */
const ORDER_SIGNS: Record<string, readonly [number, number, number, number]> = {
  XYZ: [1, -1, 1, -1],
  YXZ: [1, -1, -1, 1],
  ZXY: [-1, 1, 1, -1],
  ZYX: [-1, 1, -1, 1],
  YZX: [1, 1, -1, -1],
  XZY: [-1, -1, 1, 1],
}

/**
 * Quaternion of three turns expressed in the turning frame: `pitch` about X, `yaw` about Y,
 * `roll` about Z, composed in `order` (the first letter outermost; `XYZ` by default). With `q · turn`
 * it steers a flight; with an order, it is the rotation of a set of Euler angles.
 */
export function localTurnQuaternion(
  out: Float64Array,
  pitch: number,
  yaw: number,
  roll: number,
  order = 'XYZ',
) {
  const [sx, sy, sz, sw] = ORDER_SIGNS[order] ?? ORDER_SIGNS.XYZ
  const c1 = Math.cos(pitch / 2),
    s1 = Math.sin(pitch / 2),
    c2 = Math.cos(yaw / 2),
    s2 = Math.sin(yaw / 2),
    c3 = Math.cos(roll / 2),
    s3 = Math.sin(roll / 2)
  out[0] = s1 * c2 * c3 + sx * c1 * s2 * s3
  out[1] = c1 * s2 * c3 + sy * s1 * c2 * s3
  out[2] = c1 * c2 * s3 + sz * s1 * s2 * c3
  out[3] = c1 * c2 * c3 + sw * s1 * s2 * s3
  return out
}
