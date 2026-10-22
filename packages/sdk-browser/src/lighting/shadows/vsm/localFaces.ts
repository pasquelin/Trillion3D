/**
 * A LOCAL LIGHT'S MAP VIEWS (`localLight.ts`): the cone a spot's one perspective map takes, and the
 * six rotations of a point light's cube faces.
 */
import { DEG2RAD } from '../../../../../math/src/constants.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { normalizeVector3OrZero } from '../../../../../math/src/vector/vector.ts'
import { cross } from '../../../../../math/src/vector/vectorTuple.ts'
import { VSM_MIN_DIRECTION_SQ } from './clipmap.ts'

/** Declared: the widest half angle a spot's one perspective map takes, 88.9°: its 1 / tan, the
 *  map's scale, is 0.019 there and falls to 0 at 90°, where the map's texels stretch without bound. */
const MAX_SPOT_HALF_ANGLE = 88.9 * DEG2RAD
/** Declared: the least gap of the outer cone over the inner one, 0.001 rad. */
const SPOT_CONE_GAP = 0.001

/** The outer half angle of a spot's map, radians: at least the inner one (itself within [0, the
 *  widest]) plus the gap, at most the widest plus the gap; rounded once, to an f32. */
export function clampedOuterConeAngle(innerRad: number, outerRad: number) {
  const inner = clamp(innerRad, 0, MAX_SPOT_HALF_ANGLE)
  return Math.fround(clamp(outerRad, inner + SPOT_CONE_GAP, MAX_SPOT_HALF_ANGLE + SPOT_CONE_GAP))
}

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
