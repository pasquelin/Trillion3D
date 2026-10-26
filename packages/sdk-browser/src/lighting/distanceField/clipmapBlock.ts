import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { VEC3U } from './layout.ts'

/**
 * WHAT A CLIPMAP'S PASSES READ OF ITS PLACE (`clipmapUniforms.ts` writes it): one block of 256
 * bytes for each clipmap of each cache, read at a dynamic offset. Positions are the clipmap's own
 * translated world — the clipmap's centre at the origin — except the translation, a pair of floats,
 * that takes an absolute world position there.
 *
 * - `translationHigh` and `translationLow`: the translation of the clipmap's centre to the origin;
 * - `voxelExtent`, `influenceRadius` and its square: half a voxel, and four voxels;
 * - `pageGrid` and `cullGrid`: the pages along a clipmap, and the cells of the culling grid along it;
 * - `offsetZ`: where the clipmap's layer starts along the third axis of the page tables;
 * - `updateBounds`: the regions to composite again, from `boundsBase` in the update bounds buffer;
 * - `tiles`: where the lists of the clipmap's page tiles begin in the tiles buffer, the update list,
 *   the compose list and the culling grid's cell list; `cullHeader` and `cullArray`: those of the
 *   culling grid's cells and objects in its buffer; `control`: where the clipmap's counters begin
 *   in the control buffer; `args`: its dispatch arguments in the argument buffer; `packed`: its
 *   rank among the clipmaps updated this frame; `objectStride`: the room one clipmap's culled
 *   objects take; `maxPages`: the pages of the atlas; `flags`: bit 0 says the clipmap composites
 *   over the static one;
 * - `pageToVoxelScale` and `pageToVoxelBias`: a voxel coordinate to its centre; `pageToPageScale`
 *   and `pageToPageBias`: a page of the grid to its centre; `uvAddMul`: a position to the volume's
 *   texture coordinate, scroll included; `pageWorldRadius`, `pageWorldExtent`, `pageTileExtent`,
 *   `composeTileExtent`, `cullTileExtent`: the sizes of a page, a page with its border, a group of
 *   voxels and a cell of the grid; `cullToCentreScale` and `cullToCentreBias`: a cell to its centre.
 */
export const CLIP_BLOCK = fieldLayout('DfClip', [
  ['translationHigh', 'vec3f'],
  ['voxelExtent', 'f32'],
  ['translationLow', 'vec3f'],
  ['influenceRadius', 'f32'],
  ['pageToVoxelScale', 'vec3f'],
  ['influenceRadiusSq', 'f32'],
  ['pageToVoxelBias', 'vec3f'],
  ['pageWorldRadius', 'f32'],
  ['pageToPageScale', 'vec3f'],
  ['offsetZ', 'u32'],
  ['pageToPageBias', 'vec3f'],
  ['updateBounds', 'u32'],
  ['pageTileExtent', 'vec3f'],
  ['packed', 'u32'],
  ['pageWorldExtent', 'vec3f'],
  ['objectStride', 'u32'],
  ['composeTileExtent', 'vec3f'],
  ['maxPages', 'u32'],
  ['cullTileExtent', 'vec3f'],
  ['flags', 'u32'],
  ['cullToCentreScale', 'vec3f'],
  ['cullHeader', 'u32'],
  ['cullToCentreBias', 'vec3f'],
  ['cullArray', 'u32'],
  ['pageGrid', VEC3U],
  ['control', 'u32'],
  ['cullGrid', VEC3U],
  ['args', 'u32'],
  ['tiles', VEC3U],
  ['boundsBase', 'u32'],
  ['uvAddMul', 'vec4f'],
] as const)

/** The flags of a clipmap's block. */
export const CLIP_FLAG_PARENT = 1

/** The bytes a block is given in the buffer: a dynamic offset's alignment. */
export const CLIP_BLOCK_BYTES = 256

/** The words of the control buffer: the page free list's allocator, the allocator of the pages
 *  returned, then four counters for each clipmap slot (updated pages, culling cells, composited
 *  pages, the culling grid's allocator), then the flags of the clipmaps whose meshes were not all
 *  streamed in. */
export const CONTROL = {
  freeAllocator: 0,
  returnAllocator: 1,
  counters: 2,
  countersPerClipmap: 4,
  pending: 2 + 6 * 4,
  words: 2 + 6 * 4 + 6,
} as const

/** The words of a clipmap slot's dispatch arguments: the page tiles, the culling cells, the
 *  composition, the return of the free pages and the coverage and object grid of the pages composed (a group
 *  a page), three each. */
export const ARGS_WORDS = 15
