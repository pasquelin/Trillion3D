import { rotateByQuaternion } from '../../../../sdk-core/src/math/matrix/quaternion.ts';
import { perspectiveSlope } from '../../../../sdk-core/src/math/primitives/camera.ts';
/**
 * The arithmetic every camera controller shares, on flat numbers alone: no DOM, no host
 * vector, no allocation beyond the buffers the caller owns. `math.test.ts`
 * proves it without a browser.
 *
 * SPHERICAL CONVENTION, for the controllers that turn around a target: `radius` is the
 * distance to that target, `theta` the azimuth measured from +Z towards +X, `phi` the polar
 * angle measured from +Y. The offset is therefore
 * `(r·sinφ·sinθ, r·cosφ, r·sinφ·cosθ)`, and `phi` never reaches a pole, where the azimuth
 * would stop being defined.
 */

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

/**
 * `theta` held on the arc of azimuth that runs from `min` towards +X up to `max`, in radians;
 * the arc may cross the back of the target, where the azimuth jumps from π to −π, so `min`
 * may be greater than `max`. An infinite bound or an arc of a full turn holds nothing. An
 * azimuth already on the arc comes back as it was, and one outside it goes to the nearer end,
 * measured around the circle.
 */
export function clampAzimuth(theta: number, min: number, max: number) {
  const turn = 2 * Math.PI,
    arc = max - min;
  if (!Number.isFinite(arc) || arc >= turn) return theta;
  const span = ((arc % turn) + turn) % turn,
    past = (((theta - min) % turn) + turn) % turn;
  if (past <= span) return theta;
  return past - span < turn - past ? max : min;
}

/** World units a pixel is worth at `distance`, for a camera of vertical field `fov` degrees
 *  zoomed by `zoom`: a zoomed camera sees less, so a pixel spans less. */
export function pixelWorldScale(distance: number, fov: number, height: number, zoom = 1) {
  return (2 * distance * perspectiveSlope(fov, zoom)) / Math.max(1, height);
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
  const right = rotateByQuaternion(SCRATCH_AXIS, q, 1, 0, 0);
  out[0] = -right[0] * dx * scale;
  out[1] = -right[1] * dx * scale;
  out[2] = -right[2] * dx * scale;
  const up = rotateByQuaternion(SCRATCH_AXIS, q, 0, 1, 0);
  out[0] += up[0] * dy * scale;
  out[1] += up[1] * dy * scale;
  out[2] += up[2] * dy * scale;
  return out;
}

/** Scratch axis of the two helpers below; neither is reentrant. */
const SCRATCH_AXIS = new Float64Array(3);

/** Distance after `steps` notches of a wheel or a pinch; a notch is 5 % at speed one. */
export function dollyDistance(distance: number, steps: number, speed: number) {
  return distance * Math.pow(0.95, steps * speed);
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
  const moved = rotateByQuaternion(SCRATCH_AXIS, q, right, rise, -forward);
  position[0] += moved[0];
  position[1] += moved[1];
  position[2] += moved[2];
}
