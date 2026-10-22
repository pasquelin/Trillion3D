/**
 * WHAT THE RASTER ASKS OF THE GPU BUDGET (`renderPass.ts`): the rows a chunk takes in the worst
 * case, its lists for a chunk, and the fewest bytes its context takes beside a new set.
 */
import { clamp, clampLowWins } from '../../../../../../math/src/scalar/reals.ts'
import { textureBytesOf } from '../../../../gpu/core/textureBytes.ts'
import { storageBufferCap, type UniformSlots } from '../../../../session/memory/pools.ts'
import {
  VSM_RENDER_CMD_BYTES,
  VSM_RENDER_ORDER_BYTES,
  VSM_RENDER_PAIR_BYTES,
  VSM_RENDER_PAIR_CAPACITY,
} from '../constants.ts'
import { createVsmRowBound, type VsmChunk, type VsmWorst } from '../rows/rowPageBound.ts'
import { answerUnbound } from '../rows/rowBoundFit.ts'
import { vsmDrawFloorBytes } from '../chunks/chunkLists.ts'
import { vsmListSizing, vsmSizingFor } from '../chunks/chunkSizing.ts'
import { vsmChunkParamSlots } from '../chunks/chunkParams.ts'
import { renderTarget } from './renderPipes.ts'

/** The raster's worst case and its list sizing, rewritten by each frame and floor: read at once. */
const worst: VsmWorst = { rows: 0, cmdsPerRow: 0, pages: 0, cap: 0 }
const sizing = vsmListSizing(VSM_RENDER_PAIR_BYTES, 0, VSM_RENDER_ORDER_BYTES)
const floorBound = createVsmRowBound()

/** Rows a chunk of the raster asks for `rowCount` rows at `pages` pages in the worst case: pairs
 *  ≤ K · PoolPages, commands ≤ K · min(view mips, PoolPages), each list within one binding (`cap`
 *  entries); rewritten in place. */
export function renderChunking(
  limits: GPUSupportedLimits,
  pages: number,
  viewMips: number,
  rowCount: number,
) {
  const maxBinding = storageBufferCap(limits)
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

/** The raster's list sizing for `rowCount` rows, every one a candidate, run in `passes` view
 *  passes, under `viewWords` words of views and `lights` lights (`vsmSizingFor`). */
export const renderSizes = (
  rowCount: number,
  viewWords: number,
  lights: number,
  holds: Omit<VsmChunk, 'rows'>,
  slots: UniformSlots,
  passes: number,
) => vsmSizingFor(sizing, rowCount, rowCount, viewWords, lights, holds, slots, passes)

/**
 * The fewest bytes the raster's context of a set at `pages` pages takes to draw `rowCount` rows
 * under views of `viewWords` words and `viewMips` mips and `lights` lights, in `passes` view passes
 * (the most maps and mips one of them holds, `vsmViewPasses`): its dummy target and its lists at the chunk size, among
 * those `vsmChunkRowsWithin` tries, that takes the least. Set aside beside a new set
 * (`vsmGrant.ts`): the raster then always finds room for one chunk.
 */
export function vsmRenderFloorBytes(
  limits: GPUSupportedLimits,
  rowCount: number,
  viewWords: number,
  viewMips: number,
  pages: number,
  passes: number,
  lights: number,
) {
  if (rowCount <= 0 || viewWords <= 0) return 0
  const chunking = renderChunking(limits, pages, viewMips, rowCount)
  const rows = chunking.rows
  const holds = answerUnbound(floorBound, chunking, rows)
  const target = textureBytesOf(renderTarget())!
  return (
    target +
    vsmDrawFloorBytes(
      rows,
      renderSizes(rowCount, viewWords, lights, holds, vsmChunkParamSlots(limits), passes).sizes,
    )
  )
}
