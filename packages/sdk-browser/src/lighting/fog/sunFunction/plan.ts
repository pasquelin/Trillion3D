import { clampLowWins } from '../../../../../math/src/scalar/reals.ts'
import { hypot3 } from '../../../../../math/src/float/hypot.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { cascadeSphere } from '../../shadows/classic/cascadeSplits.ts'

/**
 * THE VIEW OF THE SUN'S LIGHT FUNCTION FOR THE VOLUMETRIC FOG, the numbers of it (`sunFog.ts` draws it, `sunFogReadWgsl.ts` reads it): the
 * light function of the sun is drawn once into a square texture laid across the sun's direction over the sphere that bounds the view
 * from the eye to the fog's distance, and each cell of the volume reads it at its point seen along the sun. The side of the texture is
 * the volume's cells along the axis the sun faces most, times a supersample scale, cut to a multiple of 32 so that the textures made
 * hold from one image to the next.
 */

/** The side of the texture is a multiple of this many texels. */
const SNAP = 32

/** A vector of three numbers. */
export type Vec3 = readonly [number, number, number]

/** The camera as the bounds read it: its world position and axes, the scales of its projection (1 over the tangent of the half field
 *  across and up), their offset when the projection is asymmetric, and whether it is a perspective one. */
export interface SunFogCamera {
  readonly eye: ArrayLike<number>
  readonly right: Vec3
  readonly up: Vec3
  readonly forward: Vec3
  readonly scaleX: number
  readonly scaleY: number
  readonly offsetX: number
  readonly offsetY: number
  readonly perspective: boolean
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!

/**
 * The side of the texture, in texels: the volume's `grid` cells along each of the camera's axes, weighed by how much the sun's
 * `direction` lies along that axis, the largest taken times `supersample`, whole, cut up to a multiple of 32. Past the device's largest
 * texture `maxSide` it is that side; never under 32, so that a supersample that rounds the estimate down to nothing still draws a texture.
 */
export function sunFogSide(
  camera: Pick<SunFogCamera, 'right' | 'up' | 'forward'>,
  direction: Vec3,
  grid: Vec3,
  supersample: number,
  maxSide: number,
) {
  const weights = [
    Math.abs(dot(direction, camera.right)) * grid[0],
    Math.abs(dot(direction, camera.up)) * grid[1],
    Math.abs(dot(direction, camera.forward)) * grid[2],
  ]
  const estimate = Math.trunc(Math.max(...weights) * supersample)
  const snapped = ceilDiv(estimate, SNAP) * SNAP
  return clampLowWins(snapped, SNAP, maxSide)
}

/**
 * The sphere that bounds the part of the view between the distances `near` and `far` along the camera's forward. A perspective view's
 * slice is a frustum: its corners (shifted by the asymmetry) and the centre along the forward that makes the sphere smallest, kept within
 * the slice (`cascadeSphere`). An orthographic view's is a box as wide as the projection says, shifted by its offset, centred in its own
 * middle. The radius is at least 1.
 */
export function frustumSliceSphere(camera: SunFogCamera, near: number, far: number) {
  if (!camera.perspective) return orthographicSliceSphere(camera, near, far)
  const tanX = 1 / camera.scaleX,
    tanY = 1 / camera.scaleY
  const { depth } = cascadeSphere(near, far, tanX, tanY)
  const at = (i: number) => camera.eye[i]! + camera.forward[i]! * depth
  const centre: Vec3 = [at(0), at(1), at(2)]
  let squared = 0
  for (const along of [near, far]) {
    // The slice's four corners at this distance: the half extents across and up, shifted by the asymmetry.
    const halfX = along * tanX,
      halfY = along * tanY
    for (const sx of [-halfX * (1 + camera.offsetX), halfX * (1 - camera.offsetX)])
      for (const sy of [-halfY * (1 + camera.offsetY), halfY * (1 - camera.offsetY)]) {
        let distance = 0
        for (let i = 0; i < 3; i++) {
          const corner =
            camera.eye[i]! + camera.forward[i]! * along + camera.right[i]! * sx + camera.up[i]! * sy
          distance += (corner - centre[i]!) ** 2
        }
        squared = Math.max(squared, distance)
      }
  }
  return { centre, radius: Math.max(Math.sqrt(squared), 1) }
}

/** The sphere of an orthographic view's slice: the box `1 / scale` wide and high on each side of the view's axis moved by the offset (the
 *  projection's translation, in half extents), as long as the slice, so centred in its middle with half its diagonal as radius. */
function orthographicSliceSphere(camera: SunFogCamera, near: number, far: number) {
  const halfX = 1 / camera.scaleX,
    halfY = 1 / camera.scaleY
  const depth = (near + far) / 2
  const across = -camera.offsetX * halfX,
    up = -camera.offsetY * halfY
  const at = (i: number) =>
    camera.eye[i]! + camera.forward[i]! * depth + camera.right[i]! * across + camera.up[i]! * up
  const centre: Vec3 = [at(0), at(1), at(2)]
  return { centre, radius: Math.max(hypot3(halfX, halfY, (far - near) / 2), 1) }
}

/** The floats of the view block (`viewWgsl.ts`): the sphere's centre and radius, the texture's right and up axes (unit) with the
 *  texture's side and, in the up's last lane, whether the texture is drawn, then the eye, then the fade distance and the disabled brightness. */
export const SUN_FOG_VIEW_FLOATS = 20

/** The fade of the sun's light function: past its `distance` from the eye (metres) the share of the sun falls over the last fifth of it to `disabled`. */
export interface SunFogFade {
  readonly distance: number
  readonly disabled: number
}

/** Writes the view block into `out`: the sphere (`centre`, `radius`), the texture's axes `right` and `up`, its `side`, whether it is `drawn`, the `eye` and the `fade`. */
export function writeSunFogView(
  out: Float32Array,
  sphere: { centre: Vec3; radius: number },
  axes: { right: Vec3; up: Vec3 },
  side: number,
  drawn: boolean,
  eye: ArrayLike<number>,
  fade: SunFogFade,
) {
  out.set(sphere.centre, 0)
  out[3] = sphere.radius
  out.set(axes.right, 4)
  out[7] = side
  out.set(axes.up, 8)
  out[11] = drawn ? 1 : 0
  out.set([eye[0]!, eye[1]!, eye[2]!], 12)
  out[15] = 0
  out[16] = fade.distance
  out[17] = fade.disabled
  out[18] = out[19] = 0
}
