import { fieldLayout, putVec4 as put } from '../../gpu/core/fieldLayout.ts'
import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import type { ResolvedFogVolume } from '../../../../sdk-core/src/scene/volume/contracts.ts'

/**
 * THE OBJECTS VOXELISED INTO THE VOLUME, as the passes read them (`voxelWgsl.ts`): one record for
 * each object that reaches the volume this image, written from the store's objects
 * (`writeVoxelObjects`), and the frame of the voxelisation (`writeVoxelFrame`).
 *
 * Every position is relative to the eye (the translated world): the object's placement and its
 * inverse, the centre of its sphere. The placement carries the box of its own space; the sphere is
 * the one around that box (`radius = half the box's diagonal × the placement's largest axis scale`),
 * which decides the slices an object reaches.
 */

/** The shapes' codes in a record's `boundsMin.w`. */
const VOXEL_SHAPE = { sphere: 0, box: 1 } as const

/** One object: its placement and the inverse, the corners of its box (the shape beside the first),
 *  the sphere around it, its albedo with the extinction beside, its emissive light. */
export const FOG_VOXEL_OBJECT = fieldLayout('FogVoxelObject', [
  ['toWorld', 'mat4x4f'],
  ['toLocal', 'mat4x4f'],
  ['boundsMin', 'vec4f'],
  ['boundsMax', 'vec4f'],
  ['sphere', 'vec4f'],
  ['albedo', 'vec4f'],
  ['emissive', 'vec4f'],
] as const)

/** What the first pass derives of an object: its sphere in view space, the box's rectangle in view
 *  space, the slices it reaches and whether it reaches any. */
export const FOG_VOXEL_SPAN = fieldLayout('FogVoxelSpan', [
  ['origin', 'vec4f'],
  ['rect', 'vec4f'],
  ['slices', 'vec4i'],
] as const)

/** The frame of the voxelisation: the inverse of the matrix the depth was drawn with (the one a
 *  surface's position is read through), the camera's right and up, the passes' numbers. */
export const FOG_VOXEL_FRAME = fieldLayout('FogVoxelFrame', [
  ['inverseDepthViewProj', 'mat4x4f'],
  ['right', 'vec4f'],
  ['up', 'vec4f'],
  ['passes', 'vec4f'],
  ['count', 'vec4u'],
] as const)

/** What the voxelisation of an image is told besides the objects. */
export interface VoxelImage {
  /** The matrix the depth buffer was drawn with, column-major. */
  depthViewProj: ArrayLike<number>
  /** The camera's world matrix, column-major: its first column is the right, its second the up. */
  world: ArrayLike<number>
  eye: ArrayLike<number>
  /** The fog's distance, metres: the farthest the volume reaches, and past which objects are left. */
  farEnd: number
  slicesPerPass: number
  showOnlyPass: number
  count: number
}

/** A count as the float that holds its bits, for the frame's integer word. */
const bits = new Uint32Array(1)
const asFloat = new Float32Array(bits.buffer)
const inverse = new Float64Array(16)
const translated = new Float64Array(16)
const toLocal = new Float64Array(16)
const half = new Float64Array(3)
const centre = new Float64Array(3)

/** The unit vector of column `column` of `world`, written into `out` from `at`. */
function putAxis(out: Float32Array, at: number, world: ArrayLike<number>, column: number) {
  const x = world[column * 4],
    y = world[column * 4 + 1],
    z = world[column * 4 + 2]
  const length = length3(x, y, z) || 1
  put(out, at, x / length, y / length, z / length)
}

/** Writes the voxelisation's frame (`FOG_VOXEL_FRAME`) into `out`. Nothing is allocated. */
export function writeVoxelFrame(out: Float32Array, image: VoxelImage) {
  const at = FOG_VOXEL_FRAME.at
  invertMatrix4(inverse, image.depthViewProj)
  copyMatrix4(out, inverse, at.inverseDepthViewProj)
  putAxis(out, at.right, image.world, 0)
  putAxis(out, at.up, image.world, 1)
  put(out, at.passes, image.slicesPerPass, image.showOnlyPass, image.farEnd)
  bits[0] = image.count
  out[at.count] = asFloat[0]
}

/** The largest scale of the placement's axes: how much it can stretch a length. */
function largestScale(m: ArrayLike<number>) {
  return Math.max(length3(m[0], m[1], m[2]), length3(m[4], m[5], m[6]), length3(m[8], m[9], m[10]))
}

/** Writes `object` as the record `slot` of `out` if it reaches the volume — its sphere closer to the
 *  eye than the fog's distance plus its radius — and its placement can be inverted; whether it was. */
function writeObject(
  out: Float32Array,
  slot: number,
  object: ResolvedFogVolume,
  eye: ArrayLike<number>,
  farEnd: number,
) {
  const m = object.matrix
  const { boundsMin: lo, boundsMax: hi } = object
  for (let r = 0; r < 3; r++) half[r] = (hi[r] - lo[r]) / 2
  const mx = lo[0] + half[0],
    my = lo[1] + half[1],
    mz = lo[2] + half[2]
  for (let r = 0; r < 3; r++)
    centre[r] = m[r] * mx + m[4 + r] * my + m[8 + r] * mz + m[12 + r] - eye[r]
  const radius = length3(half[0], half[1], half[2]) * largestScale(m)
  if (length3(centre[0], centre[1], centre[2]) >= farEnd + radius) return false
  copyMatrix4(translated, m)
  for (let r = 0; r < 3; r++) translated[12 + r] = m[12 + r] - eye[r]
  invertMatrix4(toLocal, translated)
  if (!toLocal.every(Number.isFinite)) return false
  const at = FOG_VOXEL_OBJECT.at
  const base = slot * FOG_VOXEL_OBJECT.words
  copyMatrix4(out, translated, base + at.toWorld)
  copyMatrix4(out, toLocal, base + at.toLocal)
  const { albedo, extinction, emissive } = object.material
  put(out, base + at.boundsMin, lo[0], lo[1], lo[2], VOXEL_SHAPE[object.shape])
  put(out, base + at.boundsMax, hi[0], hi[1], hi[2])
  put(out, base + at.sphere, centre[0], centre[1], centre[2], radius)
  put(out, base + at.albedo, albedo[0], albedo[1], albedo[2], extinction)
  put(out, base + at.emissive, emissive[0], emissive[1], emissive[2])
  return true
}

/**
 * Writes the objects that reach the volume into `out`, record by record from the first, and
 * returns how many: an object whose sphere lies farther from the eye than the fog's distance plus
 * its radius is left out. `out` must hold `capacity` records.
 */
export function writeVoxelObjects(
  out: Float32Array,
  capacity: number,
  objects: Iterable<ResolvedFogVolume>,
  eye: ArrayLike<number>,
  farEnd: number,
) {
  let count = 0
  for (const object of objects) {
    if (count === capacity) break
    if (writeObject(out, count, object, eye, farEnd)) count++
  }
  return count
}
