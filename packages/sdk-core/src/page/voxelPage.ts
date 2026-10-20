import { EngineError } from '../contracts/cache.ts'
import { VOXEL_BRICK_BYTES, VOXEL_RECORD_BYTES } from '../contracts/writtenFormats.ts'
import type { VoxelFile, VoxelGroup } from '../contracts/voxel.ts'

/**
 * A voxel brick as one page of the geometry pool: the words a shader reads in place
 * (`sdk-browser/src/visibility/shader/voxelWgsl.ts`), one page a brick of `voxels.bin`
 * (`../contracts/voxel.ts`). Its head, eight words: `T3VP`, its voxel count and its joint
 * (`0xFFFF` for none) in the high half, its corner (`f32` × 3, object units), its voxels' side, its
 * occupancy mask (two words, bit `x + 4y + 16z`); then each voxel's record as the file holds it, four
 * words, with its cell's rank in the brick in byte 14 — a byte the file leaves zero — so a corner
 * reads its voxel's place without walking the mask.
 *
 * A voxel draws as its contour (`voxel/bricks.rs`): the surface of its slab clipped to its cube, a
 * convex polygon of at most six corners, four triangles in a fan (`VOXEL_CORNERS`). A brick of 64
 * voxels draws 256 triangles: a page's identifier holds them all (`VIS_MAX_PAGE_TRIANGLES`).
 */

/** `T3VP` read as a little-endian u32. */
export const VOXEL_PAGE_MAGIC = 0x50563354
/** Words of a page's head, and of each voxel's record after it. */
export const VOXEL_PAGE_HEAD_WORDS = 8,
  VOXEL_WORDS = VOXEL_RECORD_BYTES / 4
/** Triangles and corners a voxel draws: its polygon's fan. */
export const VOXEL_TRIANGLES = 4,
  VOXEL_CORNERS = 3 * VOXEL_TRIANGLES
/** The geometry descriptor's flag of a voxel page (`GeometryPageDescriptor.flags`), beside the
 *  attribute flags of a `WGP3` page (`format.ts`), none of which it shares. */
export const GEOMETRY_VOXEL = 0x100
/** Byte of a voxel's record holding its cell's rank in the brick. */
const CELL_BYTE = 14

/** One brick as a page: its bytes, its voxels and its object box. */
export type VoxelPage = {
  bytes: Uint8Array<ArrayBuffer>
  voxels: number
  min: number[]
  max: number[]
}

/** Brick `b` of `group` as a page (`VOXEL_PAGE_MAGIC`), its voxels `file` holds from `voxel`. */
export function encodeVoxelPage(
  file: VoxelFile,
  group: VoxelGroup,
  b: number,
  voxel: number,
): VoxelPage {
  const { view } = file,
    at = file.brickBase + (group.firstBrick + b) * VOXEL_BRICK_BYTES
  const low = view.getUint32(at, true),
    high = view.getUint32(at + 4, true)
  const cells: number[] = []
  for (let bit = 0; bit < 64; bit++)
    if ((bit < 32 ? low >>> bit : high >>> (bit - 32)) & 1) cells.push(bit)
  const count = cells.length
  if (voxel + count > group.firstVoxel + group.voxels)
    throw new EngineError('INVALID_CACHE', 'a voxel brick lies past its group', {})
  const words = new Uint32Array(VOXEL_PAGE_HEAD_WORDS + count * VOXEL_WORDS)
  const reals = new Float32Array(words.buffer)
  const corner = [0, 1, 2].map(
    (k) => group.origin[k] + view.getUint16(at + 8 + 2 * k, true) * 4 * group.side,
  )
  words[0] = VOXEL_PAGE_MAGIC
  words[1] = count | (view.getUint16(at + 14, true) << 16)
  reals.set([...corner, group.side], 2)
  words[6] = low
  words[7] = high
  const bytes = new Uint8Array(words.buffer)
  const lo = [4, 4, 4],
    hi = [0, 0, 0]
  cells.forEach((cell, k) => {
    const from = file.voxelBase + (voxel + k) * VOXEL_RECORD_BYTES,
      to = (VOXEL_PAGE_HEAD_WORDS + k * VOXEL_WORDS) * 4
    bytes.set(new Uint8Array(view.buffer, view.byteOffset + from, VOXEL_RECORD_BYTES), to)
    bytes[to + CELL_BYTE] = cell
    const xyz = [cell & 3, (cell >> 2) & 3, cell >> 4]
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], xyz[a])
      hi[a] = Math.max(hi[a], xyz[a] + 1)
    }
  })
  const min = corner.map((c, a) => c + lo[a] * group.side),
    max = corner.map((c, a) => c + hi[a] * group.side)
  return { bytes, voxels: count, min, max }
}

/** Refuses bytes that are no voxel page, or whose count does not measure them: the pool uploads a
 *  page's words as they are, so this is its one gate. */
export function checkVoxelPage(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = bytes.byteLength >= 8 ? view.getUint32(4, true) & 0xffff : 0
  if (
    bytes.byteLength < VOXEL_PAGE_HEAD_WORDS * 4 ||
    count > 64 ||
    view.getUint32(0, true) !== VOXEL_PAGE_MAGIC ||
    bytes.byteLength !== (VOXEL_PAGE_HEAD_WORDS + count * VOXEL_WORDS) * 4
  )
    throw new EngineError('INVALID_CACHE', 'a voxel page is not one', {})
}

/** Whether `bytes` open on a voxel page's magic. */
export const isVoxelPage = (bytes: Uint8Array) =>
  bytes.byteLength >= 4 &&
  new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === VOXEL_PAGE_MAGIC
