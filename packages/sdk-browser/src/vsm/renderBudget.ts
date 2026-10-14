/**
 * WHAT THE RASTER ASKS OF THE GPU BUDGET (`renderPass.ts`): the rows a chunk takes in the worst
 * case, its lists for a chunk, and the fewest bytes its context takes beside a new set.
 */
import { clamp, clampLowWins } from '../../../math/src/scalar/reals.ts'
import { textureBytesOf } from '../gpu/core/textureBytes.ts'
import type { UniformSlots } from '../residency/pools.ts'
import {
  VSM_RENDER_CMD_BYTES,
  VSM_RENDER_PAIR_BYTES,
  VSM_RENDER_PAIR_CAPACITY,
} from './constants.ts'
import { createWorstChunk, vsmWorstChunk, type VsmChunk, type VsmWorst } from './rowPageBound.ts'
import { vsmDrawFloorBytes } from './chunkLists.ts'
import { vsmListSizing, vsmSizingFor } from './chunkSizing.ts'
import { vsmChunkParamSlots } from './chunkParams.ts'
import { renderTarget } from './renderPipes.ts'

/** The raster's worst case and its list sizing, rewritten by each frame and floor: read at once. */
const worst: VsmWorst = { rows: 0, cmdsPerRow: 0, pages: 0, cap: 0 }
const sizing = vsmListSizing(VSM_RENDER_PAIR_BYTES, 0)
const floorChunk = createWorstChunk()

/** Rows a chunk of the raster asks for `rowCount` rows at `pages` pages in the worst case: pairs
 *  ≤ K · PoolPages, commands ≤ K · min(view mips, PoolPages), each list within one binding (`cap`
 *  entries); rewritten in place. */
export function renderChunking(
  limits: GPUSupportedLimits,
  pages: number,
  viewMips: number,
  rowCount: number,
) {
  const maxBinding = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize)
  const pairs = clampLowWins(
    Math.floor(maxBinding / VSM_RENDER_PAIR_BYTES),
    pages,
    VSM_RENDER_PAIR_CAPACITY,
  )
  const cmdsPerRow = Math.min(viewMips, pages)
  let rows = Math.max(1, Math.floor(pairs / pages))
  rows = clamp(Math.floor(maxBinding / VSM_RENDER_CMD_BYTES / cmdsPerRow), 1, rows)
  worst.rows = Math.min(rows, rowCount)
  worst.cmdsPerRow = cmdsPerRow
  worst.pages = pages
  worst.cap = pairs
  return worst
}

/** The raster's list sizing for `rowCount` rows, every one a candidate (`vsmSizingFor`). */
export const renderSizes = (
  rowCount: number,
  viewWords: number,
  holds: Omit<VsmChunk, 'rows'>,
  slots: UniformSlots,
) => vsmSizingFor(sizing, rowCount, rowCount, viewWords, holds, slots)

/**
 * The fewest bytes the raster's context of a set at `pages` pages takes to draw `rowCount` rows
 * under views of `viewWords` words and `viewMips` mips: its dummy target and its lists at the
 * chunk size, among those `vsmChunkRowsWithin` tries, that takes the least. Set aside beside a new
 * set (`vsmGrant.ts`): the raster then always finds room for one chunk.
 */
export function vsmRenderFloorBytes(
  limits: GPUSupportedLimits,
  rowCount: number,
  viewWords: number,
  viewMips: number,
  pages: number,
) {
  if (rowCount <= 0 || viewWords <= 0) return 0
  const { rows, cmdsPerRow } = renderChunking(limits, pages, viewMips, rowCount)
  const holds = vsmWorstChunk(floorChunk, rows, cmdsPerRow, pages)
  const target = textureBytesOf(renderTarget())!
  return (
    target +
    vsmDrawFloorBytes(
      rows,
      renderSizes(rowCount, viewWords, holds, vsmChunkParamSlots(limits)).sizes,
    )
  )
}
