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
import { vsmWorstChunk, type VsmChunk } from './rowPageBound.ts'
import { vsmChunkListSizes, vsmDrawFloorBytes } from './chunkLists.ts'
import { vsmChunkParamSlots } from './chunkParams.ts'
import { renderTarget } from './renderPipes.ts'

/** Rows a chunk of the raster asks for `rowCount` rows in the worst case: pairs ≤ K ·
 *  PoolPages, commands ≤ K · min(view mips, PoolPages), each list within one
 *  binding (`cap` entries). */
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
  return { rows: Math.min(rows, rowCount), cmdsPerRow, cap: pairs }
}

/** The raster's lists for a chunk of `rows` rows, by buffer, its parameter slots `slots`. */
export const renderSizes =
  (rowCount: number, viewWords: number, holds: VsmChunk, slots: UniformSlots) => (rows: number) =>
    vsmChunkListSizes(rows, rowCount, rowCount, viewWords, holds, slots)

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
  const target = textureBytesOf(renderTarget())!
  return (
    target +
    vsmDrawFloorBytes(
      rows,
      renderSizes(
        rowCount,
        viewWords,
        vsmWorstChunk(rows, cmdsPerRow, pages),
        vsmChunkParamSlots(limits),
      ),
    )
  )
}
