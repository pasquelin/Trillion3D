import { clamp } from '../scalar/reals.ts'
import { length2, length3 } from './vector.ts'

/**
 * Spherical coordinates on flat numbers, shared by the camera controllers and the `math` family.
 *
 * CONVENTION: `radius` is the distance to the centre, `theta` the azimuth measured from +Z towards
 * +X, `phi` the polar angle measured from +Y. The offset is therefore
 * `(r·sinφ·sinθ, r·cosφ, r·sinφ·cosθ)`.
 */

/** Distance below which an offset no longer defines an azimuth. */
export const RADIUS_EPSILON = 1e-9
/** How close to a pole an elevation may come; beyond it the azimuth flips on every pixel. */
export const POLAR_EPSILON = 1e-6

/** Writes `[radius, theta, phi]` of `offset`, the radius its `length3`; a radius at or below
 *  `RADIUS_EPSILON` leaves the angles untouched. */
export function toSpherical(out: Float64Array, offset: ArrayLike<number>) {
  const radius = length3(offset[0], offset[1], offset[2])
  out[0] = radius
  if (radius <= RADIUS_EPSILON) return out
  out[1] = Math.atan2(offset[0], offset[2])
  out[2] = Math.acos(clamp(offset[1] / radius, -1, 1))
  return out
}

/** Writes the offset a `[radius, theta, phi]` triple describes. */
export function fromSpherical(out: Float64Array, spherical: ArrayLike<number>) {
  const sinPhi = Math.sin(spherical[2])
  out[0] = spherical[0] * sinPhi * Math.sin(spherical[1])
  out[1] = spherical[0] * Math.cos(spherical[2])
  out[2] = spherical[0] * sinPhi * Math.cos(spherical[1])
  return out
}

/**
 * Writes `[yaw, pitch]` of the direction `(x, y, z)`: `yaw = atan2(−x, −z)`, the turn about +Y from
 * −Z towards −X, and `pitch = atan2(y, length2(x, z))`, the elevation over the horizontal. The
 * inverse of `yawPitchQuaternion` applied to −Z; neither needs a unit direction, and the pitch,
 * read from the height over the horizontal length, keeps its digits at the poles as at the horizon.
 */
export function directionYawPitch(out: Float64Array, x: number, y: number, z: number) {
  out[0] = Math.atan2(-x, -z)
  out[1] = Math.atan2(y, length2(x, z))
  return out
}
