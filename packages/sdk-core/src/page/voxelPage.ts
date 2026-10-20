import { EngineError } from '../contracts/cache.ts'
import {
  GEOMETRY_VOXEL,
  VOXEL_BRICK_BYTES,
  VOXEL_BRICK_CORNERS,
  VOXEL_BRICK_TRIANGLES,
  VOXEL_BRICK_WORDS,
  VOXEL_PAGE_BRICKS,
  VOXEL_PAGE_HEAD_WORDS,
  VOXEL_PAGE_MAGIC,
  VOXEL_RECORD_BYTES,
} from '../contracts/writtenFormats.ts'
import type { VoxelFile, VoxelGroup } from '../contracts/voxel.ts'

/**
 * Voxel bricks as one page of the geometry pool: the words a shader reads in place
 * (`sdk-browser/src/visibility/shader/voxelWgsl.ts`), bricks of one group of `voxels.bin`
 * (`../contracts/voxel.ts`), or of an HLOD cell's voxels (`world-roots`, the page codec's
 * `voxel.rs`, the same words). Its head, six words: `T3VP`, its voxel count and, in the high half,
 * its brick count; its group's corner (`f32` × 3, object units), its voxels' side. Then each
 * brick's record, five words: the file's brick as it is — its occupancy mask (two words, bit
 * `x + 4y + 16z`), its corner in bricks from the group's (`u16` × 3) and its joint (`u16`,
 * `0xFFFF` for none) — and the rank in the page of its first voxel. Then each voxel's record as the
 * file holds it, three words, the bricks' voxels in turn, each brick's in its mask's order: a
 * voxel's rank is its brick's first plus the mask's bits below its own.
 *
 * A brick draws as its box — eight corners, twelve triangles —, and each pixel of it casts its ray
 * through the brick's cells, a bit of its mask each, to the first solid one
 * (`sdk-browser/src/visibility/shader/voxelWgsl.ts`, `voxelCellTrace`). A page holds at most
 * `VOXEL_PAGE_BRICKS`: its identifier names the box triangle a pixel shows, the resolve traces the
 * voxel from there.
 */

/** The page's magic, the words of its head and of each brick's record, the bricks a page holds,
 *  the corners and triangles of a brick's box (the compiler's `voxel/page.rs` owns them), and the
 *  words of each voxel's record after them. */
export {
  VOXEL_PAGE_MAGIC,
  VOXEL_PAGE_HEAD_WORDS,
  VOXEL_BRICK_WORDS,
  VOXEL_PAGE_BRICKS,
  VOXEL_BRICK_CORNERS,
  VOXEL_BRICK_TRIANGLES,
}
export const VOXEL_WORDS = VOXEL_RECORD_BYTES / 4
/** The corners a brick's box's triangles name, three each. */
export const VOXEL_BRICK_INDICES = 3 * VOXEL_BRICK_TRIANGLES
/** The cells a ray crosses at most in a 4³ brick, `4 + 4 + 4 − 2`: the bound of its trace. */
export const VOXEL_DDA_STEPS = 10
/** The geometry descriptor's flag of a voxel page (`GeometryPageDescriptor.flags`), beside the
 *  attribute flags of a `WGP3` page (`format.ts`), none of which it shares. */
export { GEOMETRY_VOXEL }

/** Bricks as a page: its bytes, its bricks and voxels, and its object box. */
export type VoxelPage = {
  bytes: Uint8Array<ArrayBuffer>
  bricks: number
  voxels: number
  min: number[]
  max: number[]
}

/** The bits a 64-bit mask holds, given as its two words. */
const popcount = (low: number, high: number) => {
  let count = 0
  for (let w = low; w; w &= w - 1) count++
  for (let w = high; w; w &= w - 1) count++
  return count
}

/** Bricks `first` to `first + count` of `group` as one page (`VOXEL_PAGE_MAGIC`), read from `file`
 *  with their voxels, the first of them voxel `voxel` of the file: at most `VOXEL_PAGE_BRICKS`
 *  bricks. Each brick's record and the voxels' are copied as the file holds them, each mask's
 *  bits counted once. */
export function encodeVoxelPage(
  file: VoxelFile,
  group: VoxelGroup,
  [first, count]: readonly [number, number],
  voxel: number,
): VoxelPage {
  if (count > VOXEL_PAGE_BRICKS)
    throw new EngineError('INVALID_CACHE', 'a voxel page holds more bricks than it names', {})
  const { view } = file
  const brickAt = (b: number) => file.brickBase + (group.firstBrick + first + b) * VOXEL_BRICK_BYTES
  const held = Array.from({ length: count }, (_, b) =>
    popcount(view.getUint32(brickAt(b), true), view.getUint32(brickAt(b) + 4, true)),
  )
  const voxels = held.reduce((sum, n) => sum + n, 0)
  if (voxel + voxels > group.firstVoxel + group.voxels)
    throw new EngineError('INVALID_CACHE', 'a voxel brick lies past its group', {})
  const voxelsAt = VOXEL_PAGE_HEAD_WORDS + count * VOXEL_BRICK_WORDS
  const words = new Uint32Array(voxelsAt + voxels * VOXEL_WORDS)
  const reals = new Float32Array(words.buffer),
    bytes = new Uint8Array(words.buffer)
  words[0] = VOXEL_PAGE_MAGIC
  words[1] = voxels | (count << 16)
  reals.set([...group.origin, group.side], 2)
  const source = (at: number, length: number) =>
    new Uint8Array(view.buffer, view.byteOffset + at, length)
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity]
  let rank = 0
  for (let b = 0; b < count; b++) {
    const record = VOXEL_PAGE_HEAD_WORDS + b * VOXEL_BRICK_WORDS
    bytes.set(source(brickAt(b), VOXEL_BRICK_BYTES), record * 4)
    words[record + VOXEL_BRICK_BYTES / 4] = rank
    rank += held[b]
    const masks = [words[record], words[record + 1]],
      corner = [words[record + 2] & 0xffff, words[record + 2] >>> 16, words[record + 3] & 0xffff]
    for (let bit = 0; bit < 64; bit++) {
      if (!((masks[bit >> 5] >>> (bit & 31)) & 1)) continue
      const xyz = [bit & 3, (bit >> 2) & 3, bit >> 4]
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], corner[a] * 4 + xyz[a])
        hi[a] = Math.max(hi[a], corner[a] * 4 + xyz[a] + 1)
      }
    }
  }
  // The bricks' voxels lie in turn in the file: one copy.
  const from = file.voxelBase + voxel * VOXEL_RECORD_BYTES
  bytes.set(source(from, voxels * VOXEL_RECORD_BYTES), voxelsAt * 4)
  const empty = voxels === 0
  const min = group.origin.map((o, a) => o + (empty ? 0 : lo[a]) * group.side),
    max = group.origin.map((o, a) => o + (empty ? 0 : hi[a]) * group.side)
  return { bytes, bricks: count, voxels, min, max }
}

/** Refuses bytes that are no voxel page, or whose counts do not measure them: the pool uploads a
 *  page's words as they are, so this is its one gate. */
export function checkVoxelPage(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const head = bytes.byteLength >= 8 ? view.getUint32(4, true) : 0
  const count = head & 0xffff,
    bricks = head >>> 16
  if (
    bytes.byteLength < VOXEL_PAGE_HEAD_WORDS * 4 ||
    bricks > VOXEL_PAGE_BRICKS ||
    count > 64 * bricks ||
    view.getUint32(0, true) !== VOXEL_PAGE_MAGIC ||
    bytes.byteLength !==
      (VOXEL_PAGE_HEAD_WORDS + bricks * VOXEL_BRICK_WORDS + count * VOXEL_WORDS) * 4
  )
    throw new EngineError('INVALID_CACHE', 'a voxel page is not one', {})
}

/** Whether `bytes` open on a voxel page's magic. */
export const isVoxelPage = (bytes: Uint8Array) =>
  bytes.byteLength >= 4 &&
  new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === VOXEL_PAGE_MAGIC
