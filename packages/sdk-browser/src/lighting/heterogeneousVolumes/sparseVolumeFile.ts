import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import {
  assertSidecarSection,
  type SidecarSection,
} from '../../../../sdk-core/src/contracts/sidecarSection.ts'

/**
 * THE SPARSE VOLUMES' FILE (`sparseVolumes.bin`, the manifest's `sparseVolumes` section), as the
 * compiler writes it (`packages/asset-compiler-rust/src/sparse_volume/abi.rs`): the frames of the
 * scene's volumes one after the other. A frame is a page table of every mip level, as a list of the
 * pages that hold a tile, and the tiles shared between pages and compressed to the voxels that are
 * not the fallback value, behind a bit mask of which they are.
 */

/** The number every frame starts with: `SVTF` read as a little-endian word. */
const FRAME_MAGIC = 0x4654_5653
const FRAME_VERSION = 1
const SECTION_VERSION = 1
const FRAME_HEAD_WORDS = 36
/** Voxels along a tile's side, without and with its border (`SPARSE_VOLUME_TILE_RES`). */
export const TILE_RES = 16
export const TILE_RES_PADDED = TILE_RES + 2
const VOXELS_PER_PADDED_TILE = TILE_RES_PADDED ** 3
const OCCUPANCY_WORDS = Math.ceil(VOXELS_PER_PADDED_TILE / 32)
/** The parent of a page of the coarsest level. */
const NO_PARENT = 0xffff_ffff

/** The formats an attribute texture takes, by the code the file holds. */
export const PIXEL_FORMATS = [
  { name: 'none', bytes: 0, gpu: undefined },
  { name: 'R8', bytes: 1, gpu: 'r8unorm' },
  { name: 'R8G8', bytes: 2, gpu: 'rg8unorm' },
  { name: 'R8G8B8A8', bytes: 4, gpu: 'rgba8unorm' },
  { name: 'R16F', bytes: 2, gpu: 'r16float' },
  { name: 'G16R16F', bytes: 4, gpu: 'rg16float' },
  { name: 'FloatRGBA', bytes: 8, gpu: 'rgba16float' },
] as const
type Vec3 = readonly [number, number, number]

/** The manifest's section of the file. */
export interface SparseVolumesSection extends SidecarSection {
  readonly volumes: readonly SparseVolumeEntry[]
}

/** One volume of the section: the node of the scene that cites it and where its frames lie. */
export interface SparseVolumeEntry {
  readonly node: number
  readonly uri: string
  /** The voxels along each side of the volume. */
  readonly resolution: Vec3
  readonly mipLevels: number
  readonly frames: readonly { offset: number; bytes: number; matrix: readonly number[] }[]
}

/** The section `section` of a manifest, or undefined for a cache whose scene cites no volume. */
export function assertSparseVolumesSection(section: unknown): SparseVolumesSection | undefined {
  const base = assertSidecarSection(section, SECTION_VERSION, 'sparse volumes')
  if (!base) return undefined
  const volumes = (section as { volumes?: unknown }).volumes
  if (!Array.isArray(volumes))
    throw new EngineError('INVALID_CACHE', 'sparse volumes: the section lists no volume', {})
  return { ...base, volumes: volumes as SparseVolumeEntry[] }
}

/** A frame of a volume, its tables views into the file's bytes. */
export interface SparseVolumeFrame {
  readonly mipCount: number
  readonly pageCount: number
  readonly tileCount: number
  /** The voxels, the lowest voxel and the highest (excluded) of the volume. */
  readonly resolution: Vec3
  readonly min: Vec3
  readonly max: Vec3
  /** The page table's size in pages and its lowest and highest (excluded) pages. */
  readonly pageTableResolution: Vec3
  readonly pageTableMin: Vec3
  readonly pageTableMax: Vec3
  /** The format code of each attribute texture; 0 for none. */
  readonly formats: readonly [number, number]
  /** The value of a voxel that is not stored, for each texture. */
  readonly fallback: readonly [Float32Array, Float32Array]
  /** The first page and the page count of each mip level. */
  readonly mipPages: Uint32Array
  readonly coords: Uint32Array
  readonly tileIndices: Uint32Array
  readonly parents: Uint32Array
  readonly tileOffsets: Uint32Array
  readonly voxelsA: Uint16Array
  readonly data: Uint8Array
}

/** Reads the frame `bytes` holds. */
export function parseSparseVolumeFrame(bytes: Uint8Array): SparseVolumeFrame {
  const bad = (why: string) => new EngineError('INVALID_CACHE', `sparse volumes: ${why}`, {})
  if (bytes.byteLength < FRAME_HEAD_WORDS * 4) throw bad('a frame is shorter than its head')
  const words = new Uint32Array(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength - (bytes.byteLength % 4),
    ),
  )
  if (words[0] !== FRAME_MAGIC) throw bad('not a frame')
  if (words[1] !== FRAME_VERSION)
    throw new EngineError('UNSUPPORTED_FORMAT', `sparse volumes: frame version ${words[1]}`, {})
  const [mipCount, pageCount, tileCount] = [words[3], words[4], words[5]]
  const vec = (at: number): Vec3 => [words[at] | 0, words[at + 1] | 0, words[at + 2] | 0]
  const formats = [words[24], words[25]] as const
  if (formats.some((code) => code >= PIXEL_FORMATS.length)) throw bad('a format is unknown')
  const floats = new Float32Array(words.buffer, 26 * 4, 8)
  const dataBytes = words[34]
  let at = FRAME_HEAD_WORDS
  const take = (count: number) => {
    const part = words.subarray(at, at + count)
    at += count
    if (at > words.length) throw bad('a table runs past the end of the file')
    return part
  }
  const mipPages = take(mipCount * 2)
  const coords = take(pageCount)
  const tileIndices = take(pageCount)
  const parents = take(pageCount)
  const tileOffsets = take(tileCount + 1)
  const voxelWords = take(Math.ceil(tileCount / 2))
  const voxelsA = new Uint16Array(voxelWords.buffer, voxelWords.byteOffset, tileCount)
  const dataStart = at * 4
  if (dataStart + dataBytes > bytes.byteLength || tileOffsets[tileCount] !== dataBytes)
    throw bad('the tile data does not fit the frame')
  return {
    mipCount,
    pageCount,
    tileCount,
    resolution: vec(6),
    min: vec(9),
    max: vec(12),
    pageTableResolution: vec(15),
    pageTableMin: vec(18),
    pageTableMax: vec(21),
    formats,
    fallback: [floats.slice(0, 4), floats.slice(4, 8)],
    mipPages,
    coords,
    tileIndices,
    parents,
    tileOffsets,
    voxelsA,
    data: bytes.subarray(dataStart, dataStart + dataBytes),
  }
}

/**
 * The padded tile `tile` of texture `attribute` (0 or 1), every voxel of it stored: the voxels the
 * file leaves out take the fallback value's bytes, `nullVoxel`. The occupancy bits of the tile's
 * textures come first, then the voxels of the first texture, then the second's.
 */
export function expandTile(
  frame: SparseVolumeFrame,
  tile: number,
  attribute: 0 | 1,
  nullVoxel: Uint8Array,
): Uint8Array {
  const size = PIXEL_FORMATS[frame.formats[attribute]].bytes
  const out = new Uint8Array(VOXELS_PER_PADDED_TILE * size)
  if (size === 0) return out
  const textures = frame.formats.filter((code) => code !== 0).length
  const begin = frame.tileOffsets[tile]
  const bits = begin + (frame.formats[0] === 0 ? 0 : attribute === 0 ? 0 : OCCUPANCY_WORDS * 4)
  const sizeA = PIXEL_FORMATS[frame.formats[0]].bytes
  let voxels = begin + textures * OCCUPANCY_WORDS * 4
  if (attribute === 1) voxels += frame.voxelsA[tile] * sizeA
  const view = new DataView(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)
  for (let voxel = 0; voxel < VOXELS_PER_PADDED_TILE; voxel++) {
    const set = (view.getUint32(bits + (voxel >> 5) * 4, true) >>> (voxel & 31)) & 1
    const source = set ? frame.data.subarray(voxels, voxels + size) : nullVoxel
    if (set) voxels += size
    out.set(source, voxel * size)
  }
  return out
}
