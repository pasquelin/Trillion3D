import { toHalf } from '../../../../math/src/float/half.ts'
import { largestAxisScale } from '../../../../math/src/vector/vector.ts'
import { multiplyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'

/**
 * THE SHAPES THAT CAST CAPSULE SHADOWS, and what the indirect shadow reads beside each: the CPU side of the
 * pass (`capsuleShadowWgsl.ts` reads what this writes).
 *
 * A skinned object carries a shadow body, a set of spheres and capsules fitted to its bones. Each is kept in
 * the rest pose of the mesh (`restBody`); each frame the bone's skinning matrix and the object's world matrix
 * carry it to the world (`writeShadowShapes`), where its centre is taken relative to the view's translation
 * (the camera-relative world the pass works in), its radius and length scaled by the largest scale of the
 * matrix and its axis made a unit vector. A sphere is a capsule of length 0.
 *
 * The indirect shadow of an object comes from one direction and one angle, the place's strongest light, which the GPU derives from the
 * record of the object (`lightDirectionWgsl.ts`): a record of four words per shape (`LIGHT_DIRECTION_WORDS`) holds the object's position, the angle of the
 * cone and the least visibility the shadow leaves, the angle and the visibility packed as two halves in the fourth word (`writeLightDirection`).
 */

/** Floats of one shape: centre, radius, unit axis, length. */
export const CAPSULE_SHAPE_FLOATS = 8
/** Words of one light direction record: the direction and the packed angle and least visibility. */
export const LIGHT_DIRECTION_WORDS = 4

/** A shadow body in the mesh's rest pose, the capsule's axis a unit vector (0, 0, 1 for a sphere). */
export interface RestBody {
  readonly bone: number
  readonly center: readonly [number, number, number]
  readonly radius: number
  readonly axis: readonly [number, number, number]
  readonly length: number
}

/** The point `p` carried by the column-major affine matrix `m`. */
const point = (
  m: ArrayLike<number>,
  p: readonly [number, number, number],
): [number, number, number] => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
]

/** The vector `v` carried by the linear part of `m`. */
const vector = (
  m: ArrayLike<number>,
  v: readonly [number, number, number],
): [number, number, number] => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
]

/** The body of a sphere of `radius` at `center` in the space of its bone, in the mesh's rest pose: `restBone`, the
 *  matrix that carries the bone's space to the mesh's in the rest pose. */
export const restSphere = (
  bone: number,
  restBone: ArrayLike<number>,
  center: readonly [number, number, number],
  radius: number,
): RestBody => ({ bone, center: point(restBone, center), radius, axis: [0, 0, 1], length: 0 })

/** The unit vector `q` (x, y, z, w) turns the z axis to: the axis of a capsule whose shape is turned by `q` in its bone's space. */
export const capsuleAxis = (
  q: readonly [number, number, number, number],
): [number, number, number] => [
  2 * (q[0] * q[2] + q[3] * q[1]),
  2 * (q[1] * q[2] - q[3] * q[0]),
  1 - 2 * (q[0] * q[0] + q[1] * q[1]),
]

/** The body of a capsule of `radius` and `length` (the straight part's) at `center` in the space of its bone, its axis `axis`
 *  in that space, in the mesh's rest pose. */
export const restCapsule = (
  bone: number,
  restBone: ArrayLike<number>,
  center: readonly [number, number, number],
  radius: number,
  axis: readonly [number, number, number],
  length: number,
): RestBody => ({
  bone,
  center: point(restBone, center),
  radius,
  axis: vector(restBone, axis),
  length,
})

/** A vector scaled to unit length; zero where it has none. */
function unit(v: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2])
  return length > 1e-8 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 0, 0]
}

/** The skinning matrix scratch (`writeShadowShapes`). */
const carried = new Float64Array(16)

/**
 * Writes the world shapes of `bodies` into `out` from float `at` on and returns how many it wrote: for each, the matrix that carries
 * its rest pose to the world — the object's `localToWorld` after the bone's skinning matrix `skin(bone)` where the mesh has
 * one, the object's alone where it has none —, and the view's translation `preViewTranslation` added to the centre.
 */
export function writeShadowShapes(
  out: Float32Array,
  at: number,
  bodies: readonly RestBody[],
  skin: (bone: number) => Float64Array | undefined,
  localToWorld: Float64Array,
  preViewTranslation: readonly [number, number, number],
) {
  let word = at
  for (const body of bodies) {
    const bone = skin(body.bone)
    const matrix = bone ? multiplyMatrix4(carried, localToWorld, bone) : localToWorld
    const scale = largestAxisScale(matrix)
    const center = point(matrix, body.center)
    const axis = unit(vector(matrix, body.axis))
    out[word] = center[0] + preViewTranslation[0]
    out[word + 1] = center[1] + preViewTranslation[1]
    out[word + 2] = center[2] + preViewTranslation[2]
    out[word + 3] = body.radius * scale
    out[word + 4] = axis[0]
    out[word + 5] = axis[1]
    out[word + 6] = axis[2]
    out[word + 7] = body.length * scale
    word += CAPSULE_SHAPE_FLOATS
  }
  return bodies.length
}

/** Writes a light direction record at word `at`: the direction as floats and the cone angle and least visibility as two halves of the
 *  last word, the angle low. */
export function writeLightDirection(
  floats: Float32Array,
  words: Uint32Array,
  at: number,
  direction: readonly [number, number, number],
  angle: number,
  minVisibility: number,
) {
  floats[at] = direction[0]
  floats[at + 1] = direction[1]
  floats[at + 2] = direction[2]
  words[at + 3] = (toHalf(angle) | (toHalf(minVisibility) << 16)) >>> 0
}

/** The least visibility an object's indirect shadow leaves, held to 0 to 1. */
export const minVisibilityOf = (value: number) => Math.min(Math.max(value, 0), 1)
