/**
 * The small vector and rotation arithmetic the play layer runs every step, on plain tuples so the
 * models stay testable in Node. Quaternions are `[x, y, z, w]`; +X east, +Y up, +Z south, and a
 * body's nose points to its local -Z, as a camera looks.
 */
export type V3 = [number, number, number];
export type Q = [number, number, number, number];

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/** The share of a gap closed in `dt` seconds by an exponential approach of time constant `tau`. */
export const approach = (dt: number, tau: number) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));

export function axisAngle(axis: readonly number[], angle: number): Q {
  const half = angle / 2;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

export function multiply(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function normalize(q: Q): Q {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

/** `v` turned by `q`. */
export function rotate(q: Q, v: readonly number[]): V3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + y * tz - z * ty,
    v[1] + w * ty + z * tx - x * tz,
    v[2] + w * tz + x * ty - y * tx,
  ];
}

/** A head turned by `yaw` about +Y, then `pitch` about its own right axis, then `roll`. */
export function yawPitchRoll(yaw: number, pitch: number, roll = 0): Q {
  return multiply(
    multiply(axisAngle([0, 1, 0], yaw), axisAngle([1, 0, 0], pitch)),
    axisAngle([0, 0, 1], roll),
  );
}

/** The rotation taking unit vector `a` onto unit vector `b` by the shortest arc. */
export function fromTo(a: readonly number[], b: readonly number[]): Q {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (dot < -0.999999) {
    const side = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const axis = [
      a[1] * side[2] - a[2] * side[1],
      a[2] * side[0] - a[0] * side[2],
      a[0] * side[1] - a[1] * side[0],
    ];
    const length = Math.hypot(axis[0], axis[1], axis[2]);
    return axisAngle([axis[0] / length, axis[1] / length, axis[2] / length], Math.PI);
  }
  const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return normalize([cross[0], cross[1], cross[2], 1 + dot]);
}

/** Euler angles (radians) applied X, then Y, then Z about the turning frame, as a quaternion. */
export const euler = (x: number, y: number, z: number): Q =>
  multiply(multiply(axisAngle([1, 0, 0], x), axisAngle([0, 1, 0], y)), axisAngle([0, 0, 1], z));

/** The shorter-arc blend of two rotations. */
export function slerp(a: Q, b: Q, t: number): Q {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  if (dot > 0.9995) return normalize([0, 1, 2, 3].map((i) => lerp(a[i], sign * b[i], t)) as Q);
  const theta = Math.acos(dot);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = (sign * Math.sin(t * theta)) / s;
  return [0, 1, 2, 3].map((i) => a[i] * wa + b[i] * wb) as Q;
}

/** Heading of a ground direction, radians about +Y, 0 looking north (-Z). */
export const headingOf = (dx: number, dz: number) => Math.atan2(-dx, -dz);
