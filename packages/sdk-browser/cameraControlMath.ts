/**
 * The arithmetic every camera controller shares, on flat numbers alone: no DOM, no host
 * vector, no allocation beyond the buffers the caller owns. `cameraControlMath.test.ts`
 * proves it without a browser.
 *
 * SPHERICAL CONVENTION, for the controllers that turn around a target: `radius` is the
 * distance to that target, `theta` the azimuth measured from +Z towards +X, `phi` the polar
 * angle measured from +Y. The offset is therefore
 * `(r·sinφ·sinθ, r·cosφ, r·sinφ·cosθ)`, and `phi` never reaches a pole, where the azimuth
 * would stop being defined.
 */

const DEG2RAD = Math.PI / 180;
/** Distance below which an offset no longer defines an azimuth. */
export const RADIUS_EPSILON = 1e-9;
/** How close to a pole an elevation may come; beyond it the azimuth flips on every pixel. */
export const POLAR_EPSILON = 1e-6;

export function clampNumber(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value;
}

/** Writes `[radius, theta, phi]` of `offset`; radius zero leaves the angles untouched. */
export function toSpherical(out: Float64Array, offset: ArrayLike<number>) {
  const radius = Math.hypot(offset[0], offset[1], offset[2]);
  out[0] = radius;
  if (radius <= RADIUS_EPSILON) return out;
  out[1] = Math.atan2(offset[0], offset[2]);
  out[2] = Math.acos(clampNumber(offset[1] / radius, -1, 1));
  return out;
}

/** Writes the offset a `[radius, theta, phi]` triple describes. */
export function fromSpherical(out: Float64Array, spherical: ArrayLike<number>) {
  const sinPhi = Math.sin(spherical[2]);
  out[0] = spherical[0] * sinPhi * Math.sin(spherical[1]);
  out[1] = spherical[0] * Math.cos(spherical[2]);
  out[2] = spherical[0] * sinPhi * Math.cos(spherical[1]);
  return out;
}

/**
 * Orientation of a camera looking at its target from `[radius, theta, phi]`, world up kept:
 * azimuth about +Y, then elevation about the camera's own X. At `phi = π/2` the camera looks
 * down -Z, the identity, which is what makes this the turntable orientation.
 */
export function orbitOrientation(out: Float64Array, spherical: ArrayLike<number>) {
  const halfAzimuth = spherical[1] / 2,
    halfPolar = (spherical[2] - Math.PI / 2) / 2;
  const sy = Math.sin(halfAzimuth),
    cy = Math.cos(halfAzimuth),
    sx = Math.sin(halfPolar),
    cx = Math.cos(halfPolar);
  out[0] = cy * sx;
  out[1] = sy * cx;
  out[2] = -sy * sx;
  out[3] = cy * cx;
  return out;
}

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

/** World units a pixel is worth at `distance`, for a camera of vertical field `fov` degrees. */
export function pixelWorldScale(distance: number, fov: number, height: number) {
  return (2 * distance * Math.tan(DEG2RAD * fov * 0.5)) / Math.max(1, height);
}

/**
 * Offset of a pan of `(dx, dy)` pixels for a camera oriented by `q`: the drag follows the
 * cursor, so the scene moves with the pointer and the camera against it.
 */
export function panOffset(
  out: Float64Array,
  q: ArrayLike<number>,
  dx: number,
  dy: number,
  scale: number,
) {
  const right = rotateByQuaternion(PAN_AXIS, q, 1, 0, 0);
  out[0] = -right[0] * dx * scale;
  out[1] = -right[1] * dx * scale;
  out[2] = -right[2] * dx * scale;
  const up = rotateByQuaternion(PAN_AXIS, q, 0, 1, 0);
  out[0] += up[0] * dy * scale;
  out[1] += up[1] * dy * scale;
  out[2] += up[2] * dy * scale;
  return out;
}

const PAN_AXIS = new Float64Array(3);

/** Distance after `steps` notches of a wheel or a pinch; a notch is 5 % at speed one. */
export function dollyDistance(distance: number, steps: number, speed: number) {
  return distance * Math.pow(0.95, steps * speed);
}

/**
 * Quaternion of a rotation expressed in the camera's OWN frame: `pitch` about its X, then
 * `yaw` about its Y, then `roll` about its Z. Composed with `q · turn`, it steers a flight.
 */
export function localTurnQuaternion(out: Float64Array, pitch: number, yaw: number, roll: number) {
  const c1 = Math.cos(pitch / 2),
    s1 = Math.sin(pitch / 2),
    c2 = Math.cos(yaw / 2),
    s2 = Math.sin(yaw / 2),
    c3 = Math.cos(roll / 2),
    s3 = Math.sin(roll / 2);
  out[0] = s1 * c2 * c3 + c1 * s2 * s3;
  out[1] = c1 * s2 * c3 - s1 * c2 * s3;
  out[2] = c1 * c2 * s3 + s1 * s2 * c3;
  out[3] = c1 * c2 * c3 - s1 * s2 * s3;
  return out;
}

/**
 * Moves `position` along the camera's own axes: `right` on its X, `rise` on its Y, `forward`
 * towards what it looks at, which is its -Z.
 */
export function moveLocal(
  position: Float64Array,
  q: ArrayLike<number>,
  right: number,
  rise: number,
  forward: number,
) {
  if (!right && !rise && !forward) return;
  const moved = rotateByQuaternion(PAN_AXIS, q, right, rise, -forward);
  position[0] += moved[0];
  position[1] += moved[1];
  position[2] += moved[2];
}
