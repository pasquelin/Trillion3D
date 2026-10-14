/**
 * Step 5: the non-cluster shadow map render on the engine's resident cluster rows — the caster cull
 * and the raster into the physical pool (`renderCullWgsl.ts`, `renderRasterWgsl.ts`). Called
 * between `encodeVsmPageMapping` and `encodeVsmAfterRaster`, before `swapFrames`: it reads
 * `res.current` (page table, flags, receiver covers, uncached rects, projection data) and writes
 * `res.pagePool` and `res.rasterMarks`.
 *
 * Every page allocated and valid for rendering this frame is drawn this frame. The work list of the
 * raster is (row, page) pairs; its worst case is rows × PoolPages (a row can touch at most
 * every valid-for-rendering page once, each physical page backs one virtual page). Rows are
 * processed in chunks, as many as the row count needs, their rows chosen by where the rows are
 * (`vsmChunkRows`: the GPU's histograms of them, `rowPageBound.ts`), or, where that cannot speak,
 * by the worst case — K = pairCapacity / PoolPages candidates, commands ≤ K · min(view mips,
 * pages), pairs ≤ K · pages —, the lists sized for that chunk within the room the device admits
 * (`vsmChunkRowsWithin`), and nothing waits for a later frame. The worst case's command bound is
 * exact: a row makes at most one command per (map, mip) — one per mip of each map view — and
 * only where its uncached rect overlaps a page flagged in that (map, mip): an allocated page of
 * it (a single-page map holds its one page at the last mip, the only rect its maps' bounds give
 * it), and each physical page backs one (map, mip).
 *
 * The camera's cut chooses the candidates on the GPU: the CPU knows no bound of them below the row
 * count, so it encodes the chunks that count needs. A chunk past the candidates culls, expands and
 * draws nothing — its cull, expand and draw read their arguments from the one argument buffer:
 * no group, no instance —; its two argument kernels run a thread each, and its raster pass clears
 * a page of dummy depth it discards (cleared on chip on a tiled GPU, where a read-only depth
 * would be loaded).
 *
 * Order (one frame per submit: parameters go through `queue.writeBuffer`):
 *   clear counters → vsmRenderCandidates (rows) → vsmRenderArgsCull
 *   per chunk: vsmRenderCull (indirect) → vsmRenderArgsExpand → vsmRenderExpand (indirect)
 *              → vsmRenderArgsDraw → raster pass, one drawIndirect into a 128×128 dummy target.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import type { PreparedPipeline } from '../lighting/deferred/fullscreen.ts'
import type { VsmLayout } from './layout.ts'
import type { VsmComputePipe } from './passKit.ts'
import type { VsmResources } from './resources.ts'
import type { VsmBoundLight, VsmRowSpheres } from './rowPageBound.ts'
import { vsmChunkRows, type VsmChunkContext, type VsmChunkKernels } from './chunkKernels.ts'
import type { vsmChunkListGroups } from './chunkGroups.ts'
import {
  vsmChunkRowsWithin,
  vsmContextBytes,
  vsmEnsureLists,
  vsmReleaseContext,
} from './chunkLists.ts'
import {
  vsmRenderViews,
  vsmWriteChunkParams,
  type VsmRenderCamera,
  type VsmRenderChunking,
} from './chunkParams.ts'
import { RENDER_LABEL, vsmRenderContext } from './renderPipes.ts'
import { renderChunking, renderSizes } from './renderBudget.ts'
import { renderGroups, vsmEncodeChunks, type RasterTables } from './renderChunks.ts'

/**
 * The engine's caster rows. `pageTable`, `spheres`, `mobility`, `rowLods` are the buffers of
 * `vis.pageTable`, `lights.spheres.buffer`, `lights.mobilityRows`, `lights.rowLods.buffer`;
 * `pageLayout` / `pageGroup` the shadow page group (`shadows.freshDraws.pageLayout`,
 * `shadowPageGroup(rt, device)`), group 0 of the raster.
 */
export interface VsmRenderScene {
  /** Rows of the page table to consider (`layout.rows.packedCount`; the blended rows after it are
   *  skipped). */
  rowCount: number
  pageTable: GPUBuffer
  spheres: GPUBuffer
  mobility: GPUBuffer
  rowLods: GPUBuffer
  pageLayout: GPUBindGroupLayout
  pageGroup: GPUBindGroup
  camera: VsmRenderCamera
  /** What changed in `spheres` (`lights.spheres`) since a frame: chunks are sized by where the rows
   *  are, from the GPU's histograms of them (`rowPageBound.ts`), or, where that cannot speak, by
   *  the worst case: every row reaching every page. */
  rowSpheres: VsmRowSpheres
}

export interface VsmRenderFrame {
  device: GPUDevice
  /** This frame's lights (`VsmFramePlan.lights`); only `shouldRender` ones are drawn. */
  lights: readonly VsmBoundLight[]
}

/** What one call encoded, for diagnostics. */
export interface VsmRenderStats {
  chunks: number
  chunkRows: number
  /** The GPU budget's room held fewer rows a chunk than asked (`vsmChunkRowsWithin`): the same
   *  pages in more passes — none at all when `chunks` is 0, the raster skipped. */
  roomLimited: boolean
}

export interface VsmRenderContext extends VsmChunkKernels, VsmChunkContext<RasterTables> {
  device: GPUDevice
  layout: VsmLayout
  pageLayout: GPUBindGroupLayout
  candidates: VsmComputePipe
  raster: {
    readonly pipeline: GPURenderPipeline
    layout1: GPUBindGroupLayout
    prepared: PreparedPipeline<GPURenderPipeline>
  }
  target: GPUTextureView
  targetTexture: GPUTexture
  /** The groups over the scene's rows and the lists alone, made again when one of them moved. */
  groups?: ReturnType<typeof vsmChunkListGroups>
}

/** Frees the raster's context of `res`, with the set it was made for (`destroyEngineVsm`). */
export function releaseVsmRender(res: VsmResources) {
  if (res.render) vsmReleaseContext(res.render)
  res.render = undefined
}

/** Bytes the raster's context of `res` holds on the device: its lists and its dummy target. */
export function vsmRenderContextBytes(res: VsmResources) {
  return res.render ? vsmContextBytes(res.render) : 0
}

/** The frame's map views, its rows and its chunking, rewritten each frame. */
const viewList: number[] = []
const range = { first: 0, end: 0, candidates: 0 }
const chunking: VsmRenderChunking = {
  rowCount: 0,
  viewCount: 0,
  chunks: 0,
  chunkRows: 0,
  cmds: 0,
  pairs: 0,
}

/**
 * Renders the casters of this frame into the pages marked and allocated this frame.
 * Nothing when no light renders or no row exists.
 */
export function encodeVsmRender(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  frame: VsmRenderFrame,
  scene: VsmRenderScene,
): VsmRenderStats | undefined {
  const { device } = frame
  const { views, viewMips } = vsmRenderViews(frame.lights, viewList)
  const viewCount = views.length / 4
  if (viewCount === 0 || scene.rowCount <= 0) return

  const ctx = vsmRenderContext(res, device, scene.pageLayout)
  const asked = renderChunking(device.limits, res.layout.poolPages, viewMips, scene.rowCount)
  range.end = range.candidates = scene.rowCount
  const chosen = vsmChunkRows(ctx.rowBound, scene.rowSpheres, range, frame.lights, asked)
  const sizing = renderSizes(scene.rowCount, views.length, chosen, ctx.slots)
  const within = vsmChunkRowsWithin(device, ctx.buffers, chosen.rows, sizing.sizes, sizing.within)
  const roomLimited = within.limited,
    size = within.size
  const chunkRows = within.rows
  if (!size) return { chunks: 0, chunkRows, roomLimited }
  const chunks = ceilDiv(scene.rowCount, chunkRows)

  const { params, views: viewsBuffer, counts, args } = vsmEnsureLists(ctx, RENDER_LABEL, size)
  chunking.rowCount = scene.rowCount
  chunking.viewCount = viewCount
  chunking.chunks = chunks
  chunking.chunkRows = chunkRows
  chunking.cmds = chosen.cmds(chunkRows)
  chunking.pairs = chosen.pairs(chunkRows)
  vsmWriteChunkParams(device, scene.camera, chunking, params, viewsBuffer, views, ctx.slots)
  encoder.clearBuffer(counts, 0, size.counts)

  const tables = renderGroups(ctx, res, scene)
  vsmEncodeChunks(encoder, ctx, tables, scene.pageGroup, args, scene.rowCount, chunks)
  return { chunks, chunkRows, roomLimited }
}
