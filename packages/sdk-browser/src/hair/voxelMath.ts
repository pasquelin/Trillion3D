import { nextPow2 } from '../../../math/src/scalar/integers.ts'
import { clamp, clampLowWins } from '../../../math/src/scalar/reals.ts'
import { HAIR_MIN_VOXEL_SIZE } from './boundsPass.ts'
import { MAX_MACRO_GROUPS } from './macroGroups.ts'

/**
 * The numbers of the hair strands' virtual voxels: a sparse volume of pages of voxels, one page index
 * a macro group, in which every segment of a strand adds its share of coverage to the voxels it
 * crosses. Lengths are in metres, the reference's centimetres over a hundred.
 */

/** The greatest voxel, in metres (a voxel's width is stored on eleven bits of this range). */
export const HAIR_MAX_VOXEL_SIZE = 1
export { HAIR_MIN_VOXEL_SIZE }
/** The steps a metre of a voxel's width is rounded to, so that the adaptive size does not oscillate. */
const VOXEL_SIZE_STEPS = 100_000
/** The words of the block of the voxel passes (`VoxelParams`). */
export const HAIR_VOXEL_PARAM_WORDS = 16
/** The words of a macro group's node: its low corner, its page index resolution, its high corner, its
 *  page index offset with its voxel width. */
export const HAIR_VOXEL_NODE_WORDS = 8
/** The voxels of a page (x) and the pages (z) a workgroup of the page passes walks. */
export const HAIR_VOXEL_PAGE_GROUP = [64, 4] as const
/** The threads of the pass that finds the pages the instances touch. */
export const HAIR_VOXEL_MARK_THREADS = 64
/** The pages of the page index a workgroup of the allocation walks. */
export const HAIR_VOXEL_ALLOCATE_THREADS = 64
/** The entries of the counter of allocated pages: the total, then one a macro group. */
export const HAIR_VOXEL_COUNTER_WORDS = MAX_MACRO_GROUPS + 1
/** The words of the arguments of the dispatches over the pages: one dispatch the total, then one a
 *  macro group. */
export const HAIR_VOXEL_ARGS_WORDS = HAIR_VOXEL_COUNTER_WORDS * 3
/** The segments of a strand the voxel raster steps along at most. */
export const HAIR_VOXEL_MAX_RASTER_COUNT = 32

/** A voxel's width as the adaptive allocation keeps it: rounded to a hundredth of a millimetre. */
export const roundVoxelSize = (size: number) =>
  Math.round(size * VOXEL_SIZE_STEPS) / VOXEL_SIZE_STEPS

/** The width of a page's side in voxels: a power of two from 8 to 256, the `requested` rounded up. The
 *  reference accepts 2 and 4 too, but its levels' pass (`hairVoxelMip`) counts the levels down by three and
 *  never ends on a page of fewer than 8 voxels: a page that small is held to 8 here. */
export const voxelPageResolution = (requested: number) =>
  nextPow2(clamp(Math.round(requested), 8, 256))

/** The levels of a page: its own and each half the size down to one voxel. */
export const voxelPageLevels = (pageResolution: number) => Math.log2(pageResolution) + 1

/** The first level the levels' pass ends on: the one of 4 voxels a side, which the same pass reduces to
 *  the last two. */
export const voxelAggregateLevel = (pageResolution: number) => voxelPageLevels(pageResolution) - 3

/** The words of a page and all its levels: the first level's voxels, then each level's, one after the
 *  other. */
export function voxelPageStride(pageResolution: number) {
  let words = 0
  for (let size = pageResolution; size >= 1; size >>= 1) words += size ** 3
  return words
}

/**
 * The pages a volume of `perDim` pages a side holds, cubed, held to what a storage binding of `limit`
 * bytes holds of pages of `pageResolution` voxels with their levels (the reference's volume is a
 * texture, which no binding limit cuts): an adaptive allocation makes the voxels larger where the pages
 * run out.
 */
export function voxelPageCount(perDim: number, pageResolution: number, limit: number) {
  const wanted = Math.max(1, Math.round(perDim)) ** 3
  const fit = Math.floor(limit / (voxelPageStride(pageResolution) * 4))
  return clampLowWins(wanted, 1, fit)
}
