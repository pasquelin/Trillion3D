import { wrap } from '../../../../math/src/scalar/reals.ts'
import { HALF_PI, TAU } from '../../../../math/src/constants.ts'
import {
  rotateByQuaternion,
  yawPitchQuaternion,
} from '../../../../math/src/quaternion/quaternion.ts'
import { perspectiveSlope } from '../../../../math/src/projection/camera.ts'
import { length2 } from '../../../../math/src/vector/vector.ts'
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
  return yawPitchQuaternion(out, spherical[1], spherical[2] - HALF_PI)
}

/**
 * `theta` held on the arc of azimuth that runs from `min` towards +X up to `max`, in radians;
 * the arc may cross the back of the target, where the azimuth jumps from π to −π, so `min`
 * may be greater than `max`. An infinite bound or an arc of a full turn holds nothing. An
 * azimuth already on the arc comes back as it was, and one outside it goes to the nearer end,
 * measured around the circle.
 */
export function clampAzimuth(theta: number, min: number, max: number) {
  const turn = TAU,
    arc = max - min
  if (!Number.isFinite(arc) || arc >= turn) return theta
  const span = wrap(arc, turn),
    past = wrap(theta - min, turn)
  if (past <= span) return theta
  return past - span < turn - past ? max : min
}

/** The optics a screen length is measured through: a perspective field of `fov` degrees, or an
 *  orthographic box's `top` and `bottom`; `zoom` 1 when the camera has none. */
export type ScreenLens = {
  projection?: string
  fov: number
  zoom?: number
  top?: number
  bottom?: number
}

/**
 * THE WORLD LENGTH THAT SPANS `share` OF THE PICTURE'S HEIGHT at view `depth`, as `lens` draws it:
 * a perspective view's grows with the depth, an orthographic one's is its box's height, whatever
 * the depth; a zoomed camera sees less, so a share spans less. A pan's pixel (`share` one over the
 * surface's height) and a handle's screen size both read it.
 */
export function screenWorldLength(lens: ScreenLens, depth: number, share: number) {
  const zoom = lens.zoom ?? 1
  if (lens.projection === 'orthographic') return ((lens.top! - lens.bottom!) / zoom) * share
  return 2 * depth * perspectiveSlope(lens.fov, zoom) * share
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
  const right = rotateByQuaternion(SCRATCH_AXIS, q, 1, 0, 0)
  out[0] = -right[0] * dx * scale
  out[1] = -right[1] * dx * scale
  out[2] = -right[2] * dx * scale
  const up = rotateByQuaternion(SCRATCH_AXIS, q, 0, 1, 0)
  out[0] += up[0] * dy * scale
  out[1] += up[1] * dy * scale
  out[2] += up[2] * dy * scale
  return out
}

/** Scratch axis of the two helpers below; neither is reentrant. */
const SCRATCH_AXIS = new Float64Array(3)

/** Distance after `steps` notches of a wheel or a pinch; a notch is 5 % at speed one. */
export function dollyDistance(distance: number, steps: number, speed: number) {
  return distance * Math.pow(0.95, steps * speed)
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
  if (!right && !rise && !forward) return
  const moved = rotateByQuaternion(SCRATCH_AXIS, q, right, rise, -forward)
  position[0] += moved[0]
  position[1] += moved[1]
  position[2] += moved[2]
}

/**
 * THE WALK OF THE KEYS: the `strafe` and `advance` axes turned by the head's `yaw` about world up
 * into a horizontal direction `out` = (x, z), a diagonal as long as a straight step — the first
 * person's walk and the character's wish both read it, so neither walks a diagonal √2 faster.
 */
export function yawWalk(out: Float64Array, yaw: number, strafe: number, advance: number) {
  const sin = Math.sin(yaw),
    cos = Math.cos(yaw),
    length = length2(strafe, advance) || 1
  out[0] = (cos * strafe - sin * advance) / length
  out[1] = (-sin * strafe - cos * advance) / length
  return out
}
