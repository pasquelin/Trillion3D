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
 * processed in chunks, as many as the row count needs, their rows chosen by one fit
 * (`vsmChunkRows`, `../rows/rowPageBound.ts`): the rows the GPU's histograms place by where they are, every
 * other row at the worst case — K = pairCapacity / PoolPages candidates, commands ≤ K · min(view
 * mips, pages), pairs ≤ K · pages —, the lists sized for that chunk within the room the device admits
 * (`vsmChunkRowsWithin`), and nothing waits for a later frame. The worst case's command bound is
 * exact: a row makes at most one command per (map, mip) — one per mip of each map view — and
 * only where its uncached rect overlaps a page flagged in that (map, mip): an allocated page of
 * it, and each physical page backs one (map, mip).
 *
 * The camera's cut chooses the candidates on the GPU: the CPU knows no bound of them below the row
 * count, so it encodes the chunks that count needs. A chunk past the candidates culls, expands and
 * draws nothing — its cull, expand and draw read their arguments from the one argument buffer:
 * no group, no instance —; its two argument kernels run a thread each, and its raster pass clears
 * a page of dummy depth it discards (cleared on chip on a tiled GPU, where a read-only depth
 * would be loaded).
 *
 * Every light's maps are culled and drawn together, however many lights and levels the frame holds,
 * in view passes (`renderViewPasses.ts`): the lights grouped whole, in order, up to the maps a
 * dispatch of the cull lists — every frame's but a device of a lower limit's has one pass —, the
 * same chunks of rows over each pass's own views. The candidates are the frame's, listed once; the
 * commands and pairs of a pass are sized for the most maps and mips any pass holds.
 *
 * A light is a culling volume: a caster is tested once against each light's — a local light's
 * range sphere, a sun's far-shadow distance (`vsmRenderCull`) — and only a caster the volume holds
 * goes on to cull against the maps of that light, those with a page to draw (`vsmRenderViews`
 * lists the lights, from the table `vsmWriteLights` lays, and their listed maps).
 *
 * Order (one frame per submit: parameters go through `queue.writeBuffer`):
 *   clear counters → vsmRenderCandidates (rows)
 *   per view pass (the second on: clear the lights' and the runs' counts): vsmRenderViews (a thread
 *              a light) → vsmRenderArgsCull
 *   per chunk: vsmRenderCull (indirect, a thread a caster and a listed light) →
 *              vsmRenderArgsExpand → vsmRenderBin (indirect) →
 *              vsmRenderExpand (indirect, once a corner tier, over its commands) →
 *              vsmRenderArgsDraw → raster pass, one drawIndirect a tier into a 128×128 dummy
 *              target.
 */
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import type { PreparedPipeline } from '../../../deferred/fullscreen.ts'
import type { VsmLayout } from '../layout.ts'
import type { VsmComputePipe } from '../passKit.ts'
import type { VsmResources } from '../resources.ts'
import { vsmChunkRows, type VsmBoundLight, type VsmRowSpheres } from '../rows/rowPageBound.ts'
import { type VsmChunkContext, type VsmChunkKernels } from '../chunks/chunkKernels.ts'
import { vsmWorldGroup, type vsmChunkListGroups } from '../chunks/chunkGroups.ts'
import {
  vsmChunkRowsWithin,
  vsmContextBytes,
  vsmEnsureLists,
  vsmReleaseContext,
} from '../chunks/chunkLists.ts'
import {
  vsmWriteChunkParams,
  vsmWriteLights,
  type VsmRenderCamera,
  type VsmRenderChunking,
} from '../chunks/chunkParams.ts'
import type { VsmShadowTessellation } from '../tessellation/shadowChain.ts'
import { RENDER_LABEL, vsmRenderContext } from './renderPipes.ts'
import { renderChunking, renderSizes } from './renderBudget.ts'
import { vsmViewPasses, vsmViewsPerPass } from './renderViewPasses.ts'
import {
  renderGroups,
  vsmEncodeChunks,
  type RasterChunkGroups,
  type RasterTables,
} from './renderChunks.ts'

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
  /** The camera cut's world switch, which the candidates obey as its descent does
   *  (`../../../../geometry/dag/shader/worldGateWgsl.ts`, `worldDraws`): its cold words and its
   *  frame words (`GpuSelection.cellStates`, `frames`), and the cold word its placements' links
   *  start at. A cut that follows no world has its frame words alone, for the draw distances
   *  (`drawDistance`): every row its level of detail selects casts. None without a cut. */
  world?: {
    cold?: GPUTextureView
    frames: GPUTextureView
    links?: number
    /** The main view's filter, held in the cut's `work` (`GpuSelection.holdFilter`): the buffer
     *  and the word its bits start at; none for a view that filters none. */
    filter?: { buffer: GPUBuffer; base: number }
  }
  /** The draw distances the objects name, which the casters take as the camera's cut does, from the
   *  main view's eye and scaled by `scale` (`cutViewDistanceScale`): present when the cut holds a
   *  placement that names one and the host did not turn the cull off (`cutDrawDistanceCulling`). */
  drawDistance?: { scale: number }
  /** What changed in `spheres` (`lights.spheres`) since a frame: chunks are sized by where the rows
   *  are, from the GPU's histograms of them (`../rows/rowPageBound.ts`), or, where that cannot speak, by
   *  the worst case: every row reaching every page. */
  rowSpheres: VsmRowSpheres
  /** Whether the table holds a voxel row: its tier is drawn then alone (`vsmEncodeChunks`). */
  voxels?: boolean
  /** Whether a sun's far-shadow test reaches every caster rather than the world's merged shells
   *  alone (`farShadowCullsAllMeshes`); false when absent. */
  farMeshes?: boolean
  /** The greatest far-shadow distance of the frame's lights when each is a sun that has one, else 0
   *  or absent (`farDropOf`): a caster past it is in no map view. */
  farDrop?: number
  /** The least share of the main view's distance a caster's object may span, as a radius over its
   *  distance, to be drawn into a map that is redrawn whole (`shadowRadiusThreshold`): the cull
   *  leaves a smaller one out of such a map; 0 or absent, none. */
  radiusThreshold?: number
  /** The tessellation of the displaced surfaces' pairs, while the frame has one
   *  (`vsmShadowTessellation`): its `kinds` say which maps take it, and the chunks run it. */
  tessellation?: VsmShadowTessellation
  /** Whether the lights whose maps would pass what a pass lists are drawn in several passes
   *  (`shadowMultipassViews`, `vsmViewPasses`); false puts every light in one. */
  multipassViews: boolean
}

export interface VsmRenderFrame {
  device: GPUDevice
  /** This frame's lights (`VsmFramePlan.lights`), every one drawn. */
  lights: readonly VsmBoundLight[]
}

/** What one call encoded, for diagnostics. */
export interface VsmRenderStats {
  /** The chunks of rows each view pass draws (`vsmViewPasses`) — none at all when 0. */
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
  /** The bin of the commands by corner tier, and the expand of each tier, lowest first
   *  (`vsmRenderExpandWgsl`). */
  bin: VsmComputePipe
  expands: VsmComputePipe[]
  raster: {
    layout1: GPUBindGroupLayout
    /** The raster pipeline of each tier, lowest first, the voxel tiers last — made the first time
     *  a table holds a voxel row —; read where it is bound. */
    tiers: PreparedPipeline<GPURenderPipeline>[]
  }
  target: GPUTextureView
  targetTexture: GPUTexture
  /** The groups over the scene's rows and the lists alone, made again when one of them moved:
   *  the chunk groups and the expand's over the lists. */
  groups?: ReturnType<typeof vsmChunkListGroups> & Pick<RasterChunkGroups, 'expand1'>
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

/** The frame's rows and its chunking, rewritten each frame. */
const range = { first: 0, end: 0, candidates: 0 }
const chunking: VsmRenderChunking = {
  rowCount: 0,
  lights: 0,
  chunks: 0,
  chunkRows: 0,
  cmds: 0,
  pairs: 0,
  passes: [],
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
  // The views' bound: every map of the frame's lights, in the view passes their maps fill; the GPU
  // lists those with pages to draw. A pass is sized for the most maps and mips any one holds.
  const limit = vsmViewsPerPass(device.limits, scene.multipassViews)
  const { list: passes, maps, mostMaps, mostMips } = vsmViewPasses(frame.lights, limit)
  if (maps === 0 || scene.rowCount <= 0) return

  const ctx = vsmRenderContext(res, device, scene.pageLayout)
  const asked = renderChunking(device.limits, res.layout.poolPages, mostMips, scene.rowCount)
  range.end = range.candidates = scene.rowCount
  const chosen = vsmChunkRows(ctx.rowBound, scene.rowSpheres, range, frame.lights, asked)
  const lights = frame.lights.length
  const words = 4 * (lights + mostMaps)
  const sizing = renderSizes(scene.rowCount, words, lights, chosen, ctx.slots, passes.length)
  const within = vsmChunkRowsWithin(device, ctx.buffers, chosen.rows, sizing.sizes, sizing.within)
  const roomLimited = within.limited,
    size = within.size
  const chunkRows = within.rows
  if (!size) return { chunks: 0, chunkRows, roomLimited }
  const chunks = ceilDiv(scene.rowCount, chunkRows)

  const { params, counts, args, lights: table } = vsmEnsureLists(ctx, RENDER_LABEL, size)
  vsmWriteLights(device, table, frame.lights)
  chunking.rowCount = scene.rowCount
  chunking.lights = lights
  chunking.chunks = chunks
  chunking.chunkRows = chunkRows
  chunking.cmds = chosen.cmds(chunkRows)
  chunking.pairs = chosen.pairs(chunkRows)
  chunking.passes = passes
  vsmWriteChunkParams(device, scene, chunking, params, ctx.slots)
  encoder.clearBuffer(counts, 0, size.counts)

  const tables = renderGroups(ctx, res, scene)
  const world = vsmWorldGroup(device, ctx.world, ctx.candidates.groups[1], scene.world)
  vsmEncodeChunks(
    encoder,
    ctx,
    tables,
    world,
    scene.pageGroup,
    args,
    chunking,
    scene.voxels,
    scene.tessellation,
  )
  return { chunks, chunkRows, roomLimited }
}
