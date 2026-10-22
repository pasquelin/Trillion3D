import { EngineError } from '../contracts/cache.ts'
import {
  DISTANCE_FIELD_BRICK,
  DISTANCE_FIELD_HEAD_BYTES,
  DISTANCE_FIELD_MAGIC,
  DISTANCE_FIELD_MAX_INDIRECTION,
  DISTANCE_FIELD_MESH_BYTES,
  DISTANCE_FIELD_MIPS,
  DISTANCE_FIELD_MIP_BYTES,
  DISTANCE_FIELD_VERSION,
} from '../contracts/distanceFieldAbi.ts'

/**
 * The mesh distance fields' file, as the compiler writes it
 * (`packages/asset-compiler-rust/src/distance_field/encode.rs`, `distanceFields.bin`): for each
 * compiled mesh that built one, its box in metres and its three mips, the finest first. A mip is
 * an indirection table — one `u32` for each cell of bricks, the rank of its brick or
 * `NO_DISTANCE_BRICK` where the cell lies beyond the band — and the bricks stored, 8 × 8 × 8
 * bytes each, a voxel the distance to the surface quantised to a byte over `[-band, band]`.
 * A mip's `scaleBias` maps that byte to a distance in the mesh's volume space (the box scaled to
 * half-extents of at most 1), `volumeToVirtualUv` a volume position to the mip's virtual texture
 * coordinate: the reference's own (`FSparseDistanceFieldMip`).
 */

/** What a cell of an indirection table holds when its brick is not stored. */
export const NO_DISTANCE_BRICK = 0xffffffff

type Vec3 = readonly [number, number, number]

/** One mip of a mesh's field. */
export interface DistanceFieldMip {
  /** The bricks along each axis of the indirection table. */
  readonly indirectionSize: Vec3
  /** The stored byte to the volume distance: `byte / 255 × scale + bias`. */
  readonly distanceScale: number
  readonly distanceBias: number
  /** A volume position to the virtual texture coordinate: `position × scale + add`. */
  readonly volumeToVirtualUvScale: Vec3
  readonly volumeToVirtualUvAdd: Vec3
  /** The bricks stored. */
  readonly brickCount: number
  /** The indirection table, a `u32` per cell, `z` then `y` then `x`. */
  readonly indirection: Uint32Array
  /** The stored bricks' voxels, 512 bytes each. */
  readonly bricks: Uint8Array
}

/** One mesh's field. */
export interface MeshDistanceField {
  /** The compiled mesh it belongs to. */
  readonly mesh: number
  /** Whether a quarter of its triangles or more are two-sided: its hits are less accurate. */
  readonly mostlyTwoSided: boolean
  /** The box the field is built around, in the mesh's object space, metres. */
  readonly min: Vec3
  readonly max: Vec3
  /** Finest first. */
  readonly mips: readonly DistanceFieldMip[]
}

const refuse = (why: string): never => {
  throw new EngineError('INVALID_CACHE', `distance fields: ${why}`, {})
}

const VOXELS = DISTANCE_FIELD_BRICK ** 3

/** The manifest's `distanceFields` section, as far as a load needs it: the file and its size. */
export interface DistanceFieldSection {
  readonly version: number
  readonly file: string
  readonly bytes: number
}

/**
 * The manifest's `distanceFields` section, or undefined when the cache has none (a scene whose
 * meshes build no field writes neither the section nor the file); a section of another version
 * throws `UNSUPPORTED_FORMAT`, one that names no file `INVALID_CACHE`.
 */
export function assertDistanceFieldSection(section: unknown): DistanceFieldSection | undefined {
  if (section === undefined || section === null) return undefined
  const named = section as Partial<DistanceFieldSection>
  if (typeof named !== 'object' || named.version !== DISTANCE_FIELD_VERSION)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      `distance fields: version ${String((named as { version?: unknown }).version)}, this engine reads ${DISTANCE_FIELD_VERSION}`,
      {},
    )
  if (typeof named.file !== 'string' || typeof named.bytes !== 'number')
    refuse('the section names no file or no size')
  return named as DistanceFieldSection
}

/** The mip whose record starts at byte `at` of `bytes`. */
function readMip(view: DataView, bytes: Uint8Array, at: number): DistanceFieldMip {
  const word = (i: number) => view.getUint32(at + i * 4, true)
  const real = (i: number) => view.getFloat32(at + i * 4, true)
  const size = [word(0), word(1), word(2)] as const
  if (size.some((side) => side === 0 || side >= DISTANCE_FIELD_MAX_INDIRECTION))
    refuse(`a mip of ${size.join(' × ')} bricks`)
  const cells = size[0] * size[1] * size[2]
  const brickCount = word(11)
  const offset = word(12)
  const length = word(13)
  if (length !== cells * 4 + brickCount * VOXELS)
    refuse('a mip whose data is not its table and bricks')
  if (offset % 4 !== 0 || offset + length > bytes.byteLength)
    refuse('a mip past the end of the file')
  const table = new Uint32Array(
    bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + cells * 4),
  )
  for (const rank of table)
    if (rank !== NO_DISTANCE_BRICK && rank >= brickCount) refuse('a brick past those stored')
  return {
    indirectionSize: size,
    distanceScale: real(3),
    distanceBias: real(4),
    volumeToVirtualUvScale: [real(5), real(6), real(7)],
    volumeToVirtualUvAdd: [real(8), real(9), real(10)],
    brickCount,
    indirection: table,
    bricks: bytes.subarray(offset + cells * 4, offset + length),
  }
}

/**
 * Reads the file `bytes` hold, or throws `INVALID_CACHE`; a file of another version throws
 * `UNSUPPORTED_FORMAT`. The bricks are views into `bytes`, which stay alive with them.
 */
export function parseDistanceFields(bytes: Uint8Array): MeshDistanceField[] {
  if (bytes.byteLength < DISTANCE_FIELD_HEAD_BYTES) refuse('shorter than its head')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== DISTANCE_FIELD_MAGIC) refuse('not a distance field file')
  const version = view.getUint32(4, true)
  if (version !== DISTANCE_FIELD_VERSION)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      `distance fields: version ${version}, this engine reads ${DISTANCE_FIELD_VERSION}`,
      {},
    )
  const count = view.getUint32(8, true)
  if (DISTANCE_FIELD_HEAD_BYTES + count * DISTANCE_FIELD_MESH_BYTES > bytes.byteLength)
    refuse('shorter than its records')
  return Array.from({ length: count }, (_, k) => {
    const at = DISTANCE_FIELD_HEAD_BYTES + k * DISTANCE_FIELD_MESH_BYTES
    const real = (i: number) => view.getFloat32(at + 8 + i * 4, true)
    const mips = Array.from({ length: DISTANCE_FIELD_MIPS }, (_, m) =>
      readMip(view, bytes, at + 8 + 24 + m * DISTANCE_FIELD_MIP_BYTES),
    )
    return {
      mesh: view.getUint32(at, true),
      mostlyTwoSided: (view.getUint32(at + 4, true) & 1) !== 0,
      min: [real(0), real(1), real(2)],
      max: [real(3), real(4), real(5)],
      mips,
    }
  })
}
