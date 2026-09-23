/**
 * Unit quaternions on flat numbers, `(x, y, z, w)`: the rotation arithmetic the camera
 * controllers and the scene objects of `../../world/` share. No allocation beyond the caller's buffers.
 */

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

/** Rescales a quaternion to unit length, so a chain of small rotations cannot drift. */
export function normalizeQuaternion(q: Float64Array) {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  for (let i = 0; i < 4; i++) q[i] /= length;
  return q;
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
