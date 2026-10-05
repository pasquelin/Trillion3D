/**
 * Unit quaternions on flat numbers, `(x, y, z, w)`: the rotation arithmetic the camera
 * controllers and the scene objects of `../../world/` share. No allocation beyond the caller's buffers.
 */
import { hypot4 } from '../primitives/hypot.ts';
import { fdlibmAcos, fdlibmSin } from '../primitives/trig.ts';

/** Quaternion of a rotation of `angle` radians about a unit axis. */
export function axisAngleQuaternion(out: Float64Array, axis: ArrayLike<number>, angle: number) {
  const half = Math.sin(angle / 2);
  out[0] = axis[0] * half;
  out[1] = axis[1] * half;
  out[2] = axis[2] * half;
  out[3] = Math.cos(angle / 2);
  return out;
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
    bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** The squared lengths between which the four squares are summed unscaled: no square overflows,
 *  and one too small to count is below 2^-1074 of the sum. */
const SQUARED_MIN = 2 ** -900,
  SQUARED_MAX = 2 ** 900;

/**
 * Rescales a quaternion to unit length, so a chain of small rotations cannot drift. The length is
 * the square root of the four squares summed as `hypot4` sums them (Kahan), without its scaling by
 * the largest magnitude: within `SQUARED_MIN`..`SQUARED_MAX` that scaling only adds roundings —
 * four divisions in and one product out. Against the exact `q / |q|`, no worse than the scaled
 * length on any input family measured and better on most (maximum 2.7 → 2.3 ULP, mean 0.73 → 0.64
 * on near-unit quaternions), and four divisions cheaper. Outside that range — zero, a NaN, an
 * infinity, magnitudes near the limits — the length is `hypot4`'s, as before.
 */
export function normalizeQuaternion(q: Float64Array) {
  return normalizeQuaternionAt(q, 0, q[0], q[1], q[2], q[3]);
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
    squared = third + (w * w - (third - sum - summand));
  const length =
    squared >= SQUARED_MIN && squared <= SQUARED_MAX ? Math.sqrt(squared) : hypot4(x, y, z, w) || 1;
  out[at] = x / length;
  out[at + 1] = y / length;
  out[at + 2] = z / length;
  out[at + 3] = w / length;
  return out;
}

/** The arc `slerpQuaternion` follows, rewritten per call. */
const arcOf = new Float64Array(3);

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
  return slerpOnArc(out, 0, a, ai, b, bi, t, slerpArc(arcOf, 0, a, ai, b, bi), 0);
}

/**
 * The arc of a slerp from the quaternion at `a[ai]` to the one at `b[bi]`, into `arc` at `at`: the
 * side (`1`, or `-1` to go the shorter way, to `-b`), the angle and its sine. It depends on the
 * two quaternions alone: a caller sampling between the same two keys several times keeps it. The
 * arc cosine and the sine are fdlibm's (`../primitives/trig.ts`): the same bits on every machine
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
  let cos = a[ai] * b[bi] + a[ai + 1] * b[bi + 1] + a[ai + 2] * b[bi + 2] + a[ai + 3] * b[bi + 3];
  const sign = cos < 0 ? -1 : 1;
  cos *= sign;
  const angle = fdlibmAcos(Math.min(1, cos));
  arc[at] = sign;
  arc[at + 1] = angle;
  arc[at + 2] = fdlibmSin(angle);
  return arc;
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
    qw = b[bi + 3];
  const sign = arc[arcAt],
    angle = arc[arcAt + 1],
    sin = arc[arcAt + 2],
    line = sin < 1e-6,
    wa = line ? 1 - t : fdlibmSin((1 - t) * angle) / sin,
    wb = line ? t * sign : (fdlibmSin(t * angle) / sin) * sign;
  out[outAt] = x * wa + qx * wb;
  out[outAt + 1] = y * wa + qy * wb;
  out[outAt + 2] = z * wa + qz * wb;
  out[outAt + 3] = w * wa + qw * wb;
  return line;
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
    tz = 2 * (q[0] * y - q[1] * x);
  out[0] = x + q[3] * tx + q[1] * tz - q[2] * ty;
  out[1] = y + q[3] * ty + q[2] * tx - q[0] * tz;
  out[2] = z + q[3] * tz + q[0] * ty - q[1] * tx;
  return out;
}

/** Sign of the second product in each of `x, y, z, w`, by the order the three turns compose in. */
const ORDER_SIGNS: Record<string, readonly [number, number, number, number]> = {
  XYZ: [1, -1, 1, -1],
  YXZ: [1, -1, -1, 1],
  ZXY: [-1, 1, 1, -1],
  ZYX: [-1, 1, -1, 1],
  YZX: [1, 1, -1, -1],
  XZY: [-1, -1, 1, 1],
};

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
  const [sx, sy, sz, sw] = ORDER_SIGNS[order] ?? ORDER_SIGNS.XYZ;
  const c1 = Math.cos(pitch / 2),
    s1 = Math.sin(pitch / 2),
    c2 = Math.cos(yaw / 2),
    s2 = Math.sin(yaw / 2),
    c3 = Math.cos(roll / 2),
    s3 = Math.sin(roll / 2);
  out[0] = s1 * c2 * c3 + sx * c1 * s2 * s3;
  out[1] = c1 * s2 * c3 + sy * s1 * c2 * s3;
  out[2] = c1 * c2 * s3 + sz * s1 * s2 * c3;
  out[3] = c1 * c2 * c3 + sw * s1 * s2 * s3;
  return out;
}
