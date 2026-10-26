import { EngineError } from '../contracts/cache.ts'
import { assertSidecarSection } from '../contracts/sidecarSection.ts'
import {
  DISTANCE_FIELD_BRICK,
  DISTANCE_FIELD_FLAG_HLOD_CELL,
  DISTANCE_FIELD_FLAG_TWO_SIDED,
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
 * compiled mesh that built one — and each HLOD cell whose actors' layer allowed one —, its box in
 * metres and its three mips, the finest first. A mip is
 * an indirection table — one `u32` for each cell of bricks, the rank of its brick or
 * `NO_DISTANCE_BRICK` where the cell lies beyond the band — and the bricks stored, 8 × 8 × 8
 * bytes each, a voxel the distance to the surface quantised to a byte over `[-band, band]`.
 * A mip's `scaleBias` maps that byte to a distance in the mesh's volume space (the box scaled to
 * half-extents of at most 1), `volumeToVirtualUv` a volume position to the mip's virtual texture
 * coordinate: the reference's own (`FSparseDistanceFieldMip`).
 */

/** What a cell of an indirection table holds when its brick is not stored. */
const NO_DISTANCE_BRICK = 0xffffffff

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
  /** The indirection table, a `u32` per cell, `z` then `y` then `x`: empty where the mip is read
   *  by `read`. */
  readonly indirection: Uint32Array
  /** The stored bricks' voxels, 512 bytes each: empty where the mip is read by `read`. */
  readonly bricks: Uint8Array
  /** Where the table and bricks are not held (a file read by parts, `parseDistanceFields`), reads
   *  them: a range of the file, checked, that the caller drops once uploaded. */
  readonly read?: () => Promise<DistanceFieldMipData>
}

/** One mesh's field. */
export interface MeshDistanceField {
  /** The compiled mesh it belongs to; for an HLOD cell's field (`hlodCell`), the cell, a rank of
   *  the world's chain of HLOD cells. */
  readonly mesh: number
  /** Whether it is the field of an HLOD cell's actors (`DISTANCE_FIELD_FLAG_HLOD_CELL`): their
   *  merged triangles in the world DAG's space, placed where the world DAG is and standing for
   *  the cell while the cell draws its actors. */
  readonly hlodCell: boolean
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

/**
 * The manifest's `distanceFields` section, or undefined when the cache has none (a scene whose
 * meshes build no field writes neither the section nor the file); a section of another version
 * throws `UNSUPPORTED_FORMAT`, one that names no file `INVALID_CACHE`.
 */
export const assertDistanceFieldSection = (section: unknown) =>
  assertSidecarSection(section, DISTANCE_FIELD_VERSION, 'distance fields')

/** A mip's indirection table and its stored bricks. */
export interface DistanceFieldMipData {
  /** The indirection table, a `u32` per cell, `z` then `y` then `x`. */
  readonly indirection: Uint32Array
  /** The stored bricks' voxels, 512 bytes each. */
  readonly bricks: Uint8Array
}

/** A file read by parts: its size, and the reader of the bytes of the mip of rank `rank` in the
 *  records' order (a mesh's mips finest first), `length` bytes from `offset`. */
export interface DistanceFieldParts {
  readonly fileBytes: number
  readonly read: (rank: number, offset: number, length: number) => Promise<ArrayBuffer>
}

/** The table and bricks `data` holds, a mip of `cells` cells and `brickCount` bricks. */
function mipData(data: Uint8Array, cells: number, brickCount: number): DistanceFieldMipData {
  if (data.byteLength !== cells * 4 + brickCount * VOXELS)
    refuse('a mip whose data is not its table and bricks')
  const indirection = new Uint32Array(data.slice(0, cells * 4).buffer)
  for (const rank of indirection)
    if (rank !== NO_DISTANCE_BRICK && rank >= brickCount) refuse('a brick past those stored')
  return { indirection, bricks: data.subarray(cells * 4) }
}

/** The mip whose record starts at byte `at` of `bytes`, of rank `rank`; its data is read from the
 *  file `bytes` hold, or, where the file is read by `parts`, when `read` is called. */
function readMip(
  view: DataView,
  bytes: Uint8Array,
  at: number,
  rank: number,
  parts?: DistanceFieldParts,
): DistanceFieldMip {
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
  if (offset % 4 !== 0 || offset + length > (parts?.fileBytes ?? bytes.byteLength))
    refuse('a mip past the end of the file')
  const head = {
    indirectionSize: size,
    distanceScale: real(3),
    distanceBias: real(4),
    volumeToVirtualUvScale: [real(5), real(6), real(7)] as const,
    volumeToVirtualUvAdd: [real(8), real(9), real(10)] as const,
    brickCount,
  }
  if (parts)
    return {
      ...head,
      indirection: new Uint32Array(0),
      bricks: new Uint8Array(0),
      read: async () =>
        mipData(new Uint8Array(await parts.read(rank, offset, length)), cells, brickCount),
    }
  return { ...head, ...mipData(bytes.subarray(offset, offset + length), cells, brickCount) }
}

/**
 * Reads the file `bytes` hold, or throws `INVALID_CACHE`; a file of another version throws
 * `UNSUPPORTED_FORMAT`. The bricks are views into `bytes`, which stay alive with them. Where the
 * file is read by `parts`, `bytes` are its head and records alone: no mip holds its table or
 * bricks, each reads them (`DistanceFieldMip.read`) when asked.
 */
export function parseDistanceFields(
  bytes: Uint8Array,
  parts?: DistanceFieldParts,
): MeshDistanceField[] {
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
      readMip(
        view,
        bytes,
        at + 8 + 24 + m * DISTANCE_FIELD_MIP_BYTES,
        k * DISTANCE_FIELD_MIPS + m,
        parts,
      ),
    )
    return {
      mesh: view.getUint32(at, true),
      hlodCell: (view.getUint32(at + 4, true) & DISTANCE_FIELD_FLAG_HLOD_CELL) !== 0,
      mostlyTwoSided: (view.getUint32(at + 4, true) & DISTANCE_FIELD_FLAG_TWO_SIDED) !== 0,
      min: [real(0), real(1), real(2)],
      max: [real(3), real(4), real(5)],
      mips,
    }
  })
}
