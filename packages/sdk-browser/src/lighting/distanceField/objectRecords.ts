import { length3 } from '../../../../math/src/vector/vector.ts'
import { inverse3 } from '../../../../math/src/matrix/matrix3.ts'
import { boxTransform } from '../../../../math/src/geometry/box.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE as CM } from '../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import type { MeshDistanceField } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import { OBJECT_BOUNDS_STRIDE, OBJECT_DATA_STRIDE, UNIQUE_BRICK } from './layout.ts'

/**
 * A PLACEMENT OF A MESH THAT HAS A DISTANCE FIELD, as the GPU's two records of it: its bounds — its
 * centre as a pair of floats, the radius of its sphere, the half-extent of its box and its flags —
 * and its data — the transform to and from the volume of its mesh, the volume's extent, the scale
 * from the volume to the world on each axis, its draw distances, its row and its mesh's asset
 * (`layout.ts`, read by `meshFieldWgsl.ts`).
 *
 * The scene is in the field's unit, the centimetre; a placement's world matrix is in metres, 16
 * numbers by column. The volume of a mesh is its box about its centre, scaled so that its largest
 * half-extent is 1. The transforms are written relative to the high part of the placement's
 * centre (the centre of its world box), so that a float holds them whatever the placement's
 * distance from the origin; the low part completes the centre.
 */

/** The 32-bit words of a record buffer, as floats and as unsigned integers. */
export interface RecordWords {
  readonly f32: Float32Array
  readonly u32: Uint32Array
}

/** A record buffer's two views of one memory. */
export function recordWords(buffer: ArrayBuffer): RecordWords {
  return { f32: new Float32Array(buffer), u32: new Uint32Array(buffer) }
}

/** What a placement's records are made of. */
export interface ObjectSource {
  /** The world matrix of the placement, metres, by column. */
  readonly world: ArrayLike<number>
  readonly field: MeshDistanceField
  /** The mesh's asset, in the scene's table. */
  readonly asset: number
  /** The placement's rank among the roots of the cut, for the passes that name a placement. */
  readonly instance: number
  readonly flags: number
  /** The nearest and the farthest distance it is drawn at, metres; none draws it everywhere. */
  readonly drawDistance?: { readonly min: number; readonly max: number }
}

const columnLength = (m: ArrayLike<number>, column: number) =>
  length3(m[column * 4], m[column * 4 + 1], m[column * 4 + 2])

/** The smallest scale of a world matrix's axes: a placement under 0.0001 is left out. */
export const minimumAxisScale = (m: ArrayLike<number>) =>
  Math.min(columnLength(m, 0), columnLength(m, 1), columnLength(m, 2))

/** The world box of the placement in centimetres, six numbers (`min` then `max`) written into
 *  `out`: its mesh's box carried by its world. */
export function objectWorldBox(
  out: Float64Array,
  world: ArrayLike<number>,
  field: MeshDistanceField,
) {
  boxTransform(out, 0, [...field.min, ...field.max], 0, world)
  for (let k = 0; k < 6; k++) out[k] *= CM
  return out
}

const split = (x: number) => {
  const high = Math.fround(x)
  return [high, Math.fround(x - high)] as const
}

/** `m · v`, `m` by column. */
const apply3 = (m: readonly number[], v: readonly number[]) =>
  [0, 1, 2].map((r) => m[r] * v[0] + m[3 + r] * v[1] + m[6 + r] * v[2])

/** The centre of the placement's world box as a pair of floats, the radius of its sphere and the
 *  half-extent of its box. */
function worldBounds(source: ObjectSource) {
  const box = objectWorldBox(new Float64Array(6), source.world, source.field)
  const centre = [0, 1, 2].map((k) => 0.5 * (box[k] + box[3 + k]))
  const extent = [0, 1, 2].map((k) => 0.5 * (box[3 + k] - box[k]))
  return { centre, extent, parts: centre.map(split) }
}

/** The transforms of the placement, relative to `high`, the high part of its centre: the world to
 *  its volume and the volume to the world, three rows each, and the scale on each volume axis. */
function volumeTransforms(source: ObjectSource, high: readonly number[]) {
  const { world, field } = source
  const centre = [0, 1, 2].map((k) => 0.5 * (field.min[k] + field.max[k]))
  const half = [0, 1, 2].map((k) => 0.5 * (field.max[k] - field.min[k]))
  const toVolume = 1 / Math.max(...half)
  const linear = [0, 1, 2, 4, 5, 6, 8, 9, 10].map((k) => world[k] * CM)
  const relative = [0, 1, 2].map((k) => world[12 + k] * CM - high[k])
  const inverse = inverse3(linear)
  const shift = apply3(inverse, relative)
  const toWorldShift = apply3(linear, centre).map((v, k) => v + relative[k])
  const worldToVolume = [0, 1, 2].map((row) => [
    toVolume * inverse[row],
    toVolume * inverse[3 + row],
    toVolume * inverse[6 + row],
    -toVolume * (shift[row] + centre[row]),
  ])
  const volumeToWorld = [0, 1, 2].map((row) => [
    linear[row] / toVolume,
    linear[3 + row] / toVolume,
    linear[6 + row] / toVolume,
    toWorldShift[row],
  ])
  const scale = [0, 1, 2].map(
    (c) => length3(linear[c * 3], linear[c * 3 + 1], linear[c * 3 + 2]) / toVolume,
  )
  return { worldToVolume, volumeToWorld, scale, extent: half.map((h) => h * toVolume) }
}

/** How far a surface is expanded when a distance is taken: a share of the finest mip's voxel. */
function surfaceExpansion(source: ObjectSource, extent: readonly number[], share: number) {
  const bricks = source.field.mips[0].indirectionSize
  const size = length3(
    ...(extent.map((e, k) => (share * e) / (bricks[k] * UNIQUE_BRICK)) as [number, number, number]),
  )
  return source.field.mostlyTwoSided ? -size : size
}

/**
 * Writes placement `index`'s records: its bounds into `bounds`, its data into `data`.
 * `surfaceBiasExpand` is the share of a voxel the surface is expanded by.
 */
export function writeObjectRecord(
  bounds: RecordWords,
  data: RecordWords,
  index: number,
  source: ObjectSource,
  surfaceBiasExpand: number,
) {
  const { parts, extent } = worldBounds(source)
  const high = parts.map(([h]) => h)
  const transforms = volumeTransforms(source, high)
  const b = index * OBJECT_BOUNDS_STRIDE * 4
  const d = index * OBJECT_DATA_STRIDE * 4
  bounds.f32.set(high, b)
  bounds.f32.set(
    parts.map(([, l]) => l),
    b + 4,
  )
  bounds.f32[b + 7] = length3(extent[0], extent[1], extent[2])
  bounds.f32.set(extent, b + 8)
  bounds.u32[b + 11] = source.flags
  data.f32.set(high, d)
  transforms.worldToVolume.forEach((row, k) => data.f32.set(row, d + 4 + 4 * k))
  const expand = surfaceExpansion(source, transforms.extent, surfaceBiasExpand)
  data.f32.set([...transforms.extent, expand], d + 16)
  const draw = source.drawDistance
  data.f32[d + 20] = draw ? (draw.min * CM) ** 2 : 0
  data.f32[d + 21] = draw ? (draw.max * CM) ** 2 : Infinity
  data.f32[d + 22] = 0
  data.u32[d + 23] = source.instance
  transforms.volumeToWorld.forEach((row, k) => data.f32.set(row, d + 24 + 4 * k))
  data.f32.set(transforms.scale, d + 36)
  data.u32[d + 39] = source.asset
}
