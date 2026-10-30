import {
  copyScaledVector3,
  crossVector3,
  dotVector3 as dot,
  length3,
  subVector3,
} from '../../../../../math/src/vector/vector.ts'
import { cross } from '../../../../../math/src/vector/vectorTuple.ts'
import { CENTIMETRES_PER_METRE as CM } from '../../../../../sdk-core/src/page/format.ts'
import { DFSH_PLANES } from './layout.ts'

/**
 * WHERE A SUN'S VOLUME LIES, from a cube of the scene: the sphere that holds it, the hull the meshes are culled to — the
 * cube's planes that face away from the light, and the planes of the silhouette edges of the cube, extruded along the light,
 * which bound every mesh that can cast a shadow onto it — and the space the meshes are listed in, a tile grid across the light
 * over that sphere. Distances are metres in, centimetres out; positions are the eye's.
 */

/** The bounds of a volume: the hull's planes (`(n, w)`, `dot(n, p) - w` positive outside, `p` from
 *  the eye, in centimetres), the sphere that holds the volume — its centre from the eye and its radius,
 *  centimetres — and the light's right and up across it. Two radii: `radius`, the sphere's own, which
 *  the grid of tiles and the boxes' growth read; `roundedRadius`, that radius rounded up to a whole
 *  centimetre, which the shadow space's scale reads (a volume whose radius moves by less than a
 *  centimetre keeps its space). */
export interface VolumeBounds {
  readonly planes: Float32Array
  readonly planeCount: number
  readonly centre: [number, number, number]
  readonly radius: number
  readonly roundedRadius: number
  readonly right: [number, number, number]
  readonly up: [number, number, number]
}

/** The vectors the bounds are worked in, made once: the cube's eight corners and six face normals, and
 *  the scratch of each step (the cube's middle, the sphere's centre, two edges, a
 *  difference, a normal, a plane's normal, the light's right); and the hull's planes before they are
 *  written out, four numbers each (at most the six faces and the twelve edges). */
const vectors = (count: number) => Array.from({ length: count }, () => new Float64Array(3))
const CORNERS = vectors(8)
const FACES = vectors(6)
const [MIDDLE, SPHERE, U, V, W, N, EDGE, RIGHT] = vectors(8)
const AXIS_Y = new Float64Array([0, 1, 0])
const AXIS_X = new Float64Array([1, 0, 0])
const PLANES = new Float64Array(4 * 18)

/** `v` scaled to unit length in place; unchanged in direction where it has no length. */
const normalise = (v: Float64Array) => copyScaledVector3(v, v, 1 / (length3(v[0], v[1], v[2]) || 1))

/** The unit normal of the plane of the edges `u` and `v` written into `out`, turned to face away from
 *  the cube's middle as seen from the point `through`. */
function facingAway(out: Float64Array, u: Float64Array, v: Float64Array, through: Float64Array) {
  normalise(crossVector3(N, u, v))
  subVector3(W, MIDDLE, through)
  return copyScaledVector3(out, N, dot(N, W) > 0 ? -1 : 1)
}

/** The plane `(n, dot(n, through))` kept as the hull's plane number `at`. */
function putPlane(at: number, n: Float64Array, through: Float64Array) {
  PLANES[4 * at] = n[0]
  PLANES[4 * at + 1] = n[1]
  PLANES[4 * at + 2] = n[2]
  PLANES[4 * at + 3] = dot(n, through)
}

/** The faces that meet at each of the cube's twelve edges, two face indices each (near, left, right,
 *  top, bottom, far), and the two corners that end each edge, flat. */
const ADJACENT = [0, 2, 0, 4, 0, 1, 0, 3, 2, 3, 4, 2, 1, 4, 3, 1, 2, 5, 4, 5, 1, 5, 3, 5]
const EDGE_CORNERS = [0, 1, 1, 3, 3, 2, 2, 0, 0, 4, 1, 5, 3, 7, 2, 6, 4, 5, 5, 7, 7, 6, 6, 4]
/** The three corners that span each face, flat: near, left, right, top, bottom, far. */
const FACE_CORNERS = [3, 2, 0, 7, 6, 2, 0, 4, 5, 2, 6, 4, 5, 7, 3, 4, 6, 7]
/** The signs, along the right and up, of a face's four corners: top right, bottom right, top
 *  left, bottom left. */
const CORNER_SIGNS = [1, 1, 1, -1, -1, 1, -1, -1]

/**
 * The bounds of the cube of half side `half` (metres) about `centre` (metres, from the eye), for the light shining from the direction
 * `toLight` (a unit vector): the hull of the cube and of the space it sweeps toward the light, for a volume of
 * the scene (the surface cache's cube about the view).
 */
export function boxBounds(
  centre: readonly [number, number, number],
  half: number,
  toLight: readonly number[],
): VolumeBounds {
  // The cube's corners in a fixed order: top right, bottom right, top left, bottom left, near then far.
  for (let corner = 0; corner < 8; corner++) {
    const sx = CORNER_SIGNS[2 * (corner % 4)],
      sy = CORNER_SIGNS[2 * (corner % 4) + 1]
    CORNERS[corner][0] = centre[0] + sx * half
    CORNERS[corner][1] = centre[1] + sy * half
    CORNERS[corner][2] = centre[2] + (corner < 4 ? half : -half)
  }
  for (let k = 0; k < 3; k++) SPHERE[k] = centre[k]
  return hullOfCorners(toLight, half * Math.sqrt(3) * CM)
}

/** The slice of a view's frustum between depths `near` and `far` (metres), seen from the eye along `forward`, `right` and `up` (unit) with the half-field tangents `tan`, and the sphere that holds it: the centre at depth `centre`, radius `radius` (metres). */
export interface FrustumSlice {
  readonly forward: ArrayLike<number>
  readonly right: ArrayLike<number>
  readonly up: ArrayLike<number>
  readonly tan: readonly [number, number]
  readonly near: number
  readonly far: number
  readonly centre: number
  readonly radius: number
}

/**
 * The bounds of a slice of the view's frustum (positions from the eye), for the light shining from `toLight`: the hull of the slice and of the space it
 * sweeps toward the light, in the cube's order of corners (the slice's near corners first), the sphere that holds it (`FrustumSlice`).
 */
export function sliceBounds(slice: FrustumSlice, toLight: readonly number[]): VolumeBounds {
  const { forward, right, up, tan, near, far } = slice
  for (let corner = 0; corner < 8; corner++) {
    const sx = CORNER_SIGNS[2 * (corner % 4)],
      sy = CORNER_SIGNS[2 * (corner % 4) + 1]
    const depth = corner < 4 ? near : far
    for (let k = 0; k < 3; k++)
      CORNERS[corner][k] =
        forward[k] * depth + right[k] * sx * depth * tan[0] + up[k] * sy * depth * tan[1]
  }
  for (let k = 0; k < 3; k++) SPHERE[k] = forward[k] * slice.centre
  return hullOfCorners(toLight, slice.radius * CM)
}

/** The hull of the eight `CORNERS` (a cube's) and what they sweep toward the light, the bounding sphere `SPHERE` of radius `radius` (centimetres). */
function hullOfCorners(toLight: readonly number[], radius: number): VolumeBounds {
  for (let k = 0; k < 3; k++) {
    let sum = 0
    for (const corner of CORNERS) sum += corner[k]
    MIDDLE[k] = sum / 8
  }
  // A face's plane through three of the corners, its normal turned away from the cube's middle.
  for (let face = 0; face < 6; face++) {
    const a = CORNERS[FACE_CORNERS[3 * face]]
    const b = CORNERS[FACE_CORNERS[3 * face + 1]]
    const c = CORNERS[FACE_CORNERS[3 * face + 2]]
    facingAway(FACES[face], subVector3(U, b, a), subVector3(V, c, a), a)
  }
  let planes = 0
  // The faces that turn their back to the light.
  for (let face = 0; face < 6; face++)
    if (dot(FACES[face], toLight) < 0)
      putPlane(planes++, FACES[face], CORNERS[FACE_CORNERS[3 * face]])
  // The silhouette edges, where a face toward the light meets one away from it, extruded toward it.
  for (let edge = 0; edge < 12; edge++) {
    const a = ADJACENT[2 * edge],
      b = ADJACENT[2 * edge + 1]
    if (dot(FACES[a], toLight) * dot(FACES[b], toLight) >= 0) continue
    const first = CORNERS[EDGE_CORNERS[2 * edge]],
      second = CORNERS[EDGE_CORNERS[2 * edge + 1]]
    subVector3(U, first, second)
    const reach = length3(U[0], U[1], U[2])
    for (let k = 0; k < 3; k++) EDGE[k] = first[k] + toLight[k] * reach
    facingAway(RIGHT, subVector3(U, second, first), subVector3(V, EDGE, first), first)
    putPlane(planes++, RIGHT, first)
  }
  const hull = new Float32Array(DFSH_PLANES * 4)
  const count = Math.min(planes, DFSH_PLANES)
  for (let k = 0; k < count; k++) {
    hull[4 * k] = PLANES[4 * k]
    hull[4 * k + 1] = PLANES[4 * k + 1]
    hull[4 * k + 2] = PLANES[4 * k + 2]
    hull[4 * k + 3] = PLANES[4 * k + 3] * CM
  }
  // The light's right and up: any pair across it, stable while the light is.
  normalise(crossVector3(RIGHT, Math.abs(toLight[1]) < 0.999 ? AXIS_Y : AXIS_X, toLight))
  const right: [number, number, number] = [RIGHT[0], RIGHT[1], RIGHT[2]]
  return {
    planes: hull,
    planeCount: count,
    centre: copyScaledVector3<[number, number, number]>([0, 0, 0], SPHERE, CM),
    radius,
    roundedRadius: Math.ceil(radius),
    right,
    up: cross(toLight, right),
  }
}
