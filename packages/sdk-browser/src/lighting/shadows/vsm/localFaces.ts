/**
 * A LOCAL LIGHT'S MAP VIEWS (`localLight.ts`): the cone a spot's one perspective map takes and its
 * projection, the six rotations of a point light's cube faces — a rectangle's too — and their
 * projection, and the world-to-light rotation each kind keys its cache entry by.
 */
import { QUARTER_PI } from '../../../../../math/src/constants.ts'
import { focalScale } from '../../../../../math/src/projection/camera.ts'
import { forwardPerspectiveProjection } from '../../../../../math/src/projection/forwardZ.ts'
import { multiplyMatrix4 } from '../../../../../math/src/matrix/matrix4.ts'
import {
  normalizeVector3OrZero,
  transformAffinePoint,
} from '../../../../../math/src/vector/vector.ts'
import { cross } from '../../../../../math/src/vector/vectorTuple.ts'
import { VSM_FACE_MATRIX, VSM_MIN_DIRECTION_SQ, vsmWorldToLightRotation } from './clipmap.ts'
import { VSM_LOCAL_NEAR_PLANE, VSM_UNIT_PER_CM } from './constants.ts'
import {
  coneSphereAlong,
  coneSphereRadius,
} from '../../../../../sdk-core/src/scene/light/drawRange.ts'

/** The nearest depth a local light's casters take: 0.1 cm. */
const VSM_LOCAL_MIN_LIGHT_W = 0.1 * VSM_UNIT_PER_CM

/** The cube face directions and up vectors. */
const CUBE_DIRECTIONS: [number, number, number][] = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
]
const UP_VECTORS: [number, number, number][] = [
  [0, 1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [0, 1, 0],
  [0, 1, 0],
]
/**
 * Face i's view rotation, a look-from matrix of (Dir_i, Up_i) scaled by (1,-1,1) then (1,1,-1)
 * (light position removed: the face matrices are relative to the light). The
 * same six for every point light (`POINT_FACE_VIEWS`).
 */
function pointFaceView(face: number) {
  const z: [number, number, number] = [0, 0, 0],
    x: [number, number, number] = [0, 0, 0]
  normalizeVector3OrZero(z, CUBE_DIRECTIONS[face], VSM_MIN_DIRECTION_SQ)
  normalizeVector3OrZero(x, cross(UP_VECTORS[face], z), VSM_MIN_DIRECTION_SQ)
  const y = cross(z, x)
  const m = new Float64Array(16)
  for (let r = 0; r < 3; r++) {
    m[r * 4 + 0] = x[r]
    m[r * 4 + 1] = -y[r]
    m[r * 4 + 2] = -z[r]
  }
  m[15] = 1
  return m
}
export const POINT_FACE_VIEWS = Array.from({ length: 6 }, (_, face) => pointFaceView(face))

/**
 * A rectangle's world-to-light rotation, column-major, written into `out`: its width axis, the axis
 * across it and its face normal as rows (the two given, unit and perpendicular). Its six faces are
 * a point light's, aligned to the world, so no map reads it: it keys the light's cache entry, which
 * a rotated rectangle starts again.
 */
function rectWorldToLight(out: Float64Array, normal: ArrayLike<number>, right: ArrayLike<number>) {
  const nx = normal[0],
    ny = normal[1],
    nz = normal[2],
    rx = right[0],
    ry = right[1],
    rz = right[2]
  out.fill(0)
  out[0] = rx
  out[4] = ry
  out[8] = rz
  out[1] = ny * rz - nz * ry
  out[5] = nz * rx - nx * rz
  out[9] = nx * ry - ny * rx
  out[2] = nx
  out[6] = ny
  out[10] = nz
  out[15] = 1
  return out
}

const spotCentre = new Float64Array(3)

/** What a local light's rotation reads of it: a spot's direction, a rectangle's face normal
 *  (`direction`) and width axis (`right`). */
export type LocalAxes =
  | { kind: 'point' }
  | { kind: 'spot'; direction: ArrayLike<number> }
  | { kind: 'rect'; direction: ArrayLike<number>; right: ArrayLike<number> }

/**
 * The world-to-light rotation of a local light into `out`, and its unit axis into `axis`: a spot's
 * X axis is its direction; a point light's faces are world-aligned, its rotation the identity; a
 * rectangle's faces are a point light's, its own rotation (`rectWorldToLight`, its normal and its
 * width axis) only keying its cache entry.
 */
export function localWorldToLight(
  out: Float64Array,
  axis: [number, number, number],
  light: LocalAxes,
) {
  if (light.kind === 'spot') normalizeVector3OrZero(axis, light.direction, VSM_MIN_DIRECTION_SQ)
  else {
    axis[0] = 1
    axis[1] = axis[2] = 0
  }
  return light.kind === 'rect'
    ? rectWorldToLight(out, light.direction, light.right)
    : vsmWorldToLightRotation(out, axis)
}

/** The projection of the six faces of a point light's or a rectangle's cube, a quarter turn wide
 *  and as deep as its `range`, into `viewToClip`. */
export function cubeFaceProjection(viewToClip: Float64Array, range: number) {
  forwardPerspectiveProjection(
    viewToClip,
    focalScale(Math.fround(QUARTER_PI)),
    VSM_LOCAL_NEAR_PLANE,
    range,
  )
}

/**
 * A spot's one map: its view into `spotView` (the face matrix over the world-to-light rotation
 * `worldToLight`) and its projection into `viewToClip`, as wide as the outer cone `outerCone` and
 * between the nearest and farthest depths the cone's bounding sphere holds, never past `range`
 * (the outer scale: no border at 16384²). `axis` is the spot's unit direction.
 */
export function spotMapProjection(
  spotView: Float64Array,
  viewToClip: Float64Array,
  worldToLight: Float64Array,
  axis: readonly number[],
  range: number,
  outerCone: number,
) {
  const cosOuter = Math.fround(Math.cos(outerCone)),
    invTanOuter = Math.fround(focalScale(outerCone))
  // The bounding sphere of the cone, relative to the light: past a half angle of 45° (cos² = 1/2)
  // the sphere through the cap's rim, its centre on the axis at the rim's foot; below, the
  // sphere through the light and the rim.
  const sphereOffset = coneSphereAlong(range, cosOuter),
    sphereRadius = coneSphereRadius(range, cosOuter)
  multiplyMatrix4(spotView, VSM_FACE_MATRIX, worldToLight)
  const c = transformAffinePoint(
    spotCentre,
    spotView,
    axis[0] * sphereOffset,
    axis[1] * sphereOffset,
    axis[2] * sphereOffset,
  )
  let depthFar = Math.fround(c[2] + sphereRadius)
  const depthNear = Math.fround(Math.max(depthFar - sphereRadius * 2, VSM_LOCAL_MIN_LIGHT_W))
  depthFar = Math.fround(Math.min(depthFar, range))
  forwardPerspectiveProjection(viewToClip, invTanOuter, depthNear, depthFar)
}
