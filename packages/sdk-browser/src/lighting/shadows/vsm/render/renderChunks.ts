/**
 * THE RASTER'S CHUNKS ENCODED (`renderPass.ts`): its groups — over the scene's rows and the lists,
 * made again when one of them moved, and over the VSM tables once a frame set —, then the
 * candidates and, for each view pass (`renderViewPasses.ts`), its views and, for each chunk, its
 * cull and expand pass and its raster pass.
 */
import { sequentialEntries } from '../../../../gpu/core/computeBindings.ts'
import { VSM_RENDER_CULL_SPECS } from './renderCullWgsl.ts'
import {
  VSM_RENDER_ARGS_BIN,
  VSM_RENDER_ARGS_DRAW,
  VSM_RENDER_ARGS_STRIDE_WORDS,
  VSM_RENDER_ARGS_TIER_EXPAND,
  VSM_RENDER_CORNER_TIERS,
  VSM_RENDER_COUNT_VIEWS,
  VSM_RENDER_TIERS,
} from './renderParamsWgsl.ts'
import type { PreparedPipeline } from '../../../deferred/fullscreen.ts'
import { VSM_RENDER_EXPAND_SPECS } from './renderExpandWgsl.ts'
import { VSM_RENDER_VIEWS_SPECS } from './renderViewsWgsl.ts'
import {
  VSM_RENDER_RASTER_FRAGMENT_SPECS,
  VSM_RENDER_RASTER_VERTEX_SPECS,
} from './renderRasterWgsl.ts'
import { vsmBindGroupEntries, vsmPerFrameSet, type VsmResources } from '../resources.ts'
import type { VsmChunkKernels } from '../chunks/chunkKernels.ts'
import { vsmBufferGroup } from '../passKit.ts'
import {
  encodeVsmCandidates,
  encodeVsmChunkCommands,
  encodeVsmViews,
  vsmChunkListGroups,
  vsmSceneRowsMoved,
  type VsmChunkGroups,
} from '../chunks/chunkGroups.ts'
import type { VsmRenderContext, VsmRenderScene } from './renderPass.ts'
import type { VsmShadowTessellation } from '../tessellation/shadowChain.ts'
import { vsmChunkSlot, type VsmRenderChunking } from '../chunks/chunkParams.ts'

/** Chunk `c`'s commands (`encodeVsmChunkCommands`), their bin by corner tier, then the expand of
 *  each of the first `tiers` tiers over its commands, lowest first (marking jobs and the raster's
 *  pages), and the draws' arguments, in `pass`. */
function encodeVsmChunkCull(
  pass: GPUComputePassEncoder,
  kernels: VsmChunkKernels & Pick<VsmRenderContext, 'bin' | 'expands'>,
  groups: RasterChunkGroups,
  args: GPUBuffer,
  c: number,
  offset: readonly number[],
  tiers: number,
) {
  encodeVsmChunkCommands(pass, kernels, groups, args, c, offset)
  const at = (word: number) => (c * VSM_RENDER_ARGS_STRIDE_WORDS + word) * 4
  pass.setPipeline(kernels.bin.pipeline)
  pass.setBindGroup(0, groups.expand0)
  pass.setBindGroup(1, groups.expand1, offset)
  pass.dispatchWorkgroupsIndirect(args, at(VSM_RENDER_ARGS_BIN))
  for (let t = 0; t < tiers; t++) {
    pass.setPipeline(kernels.expands[t].pipeline)
    pass.dispatchWorkgroupsIndirect(args, at(VSM_RENDER_ARGS_TIER_EXPAND + 3 * t))
  }
  pass.setPipeline(kernels.args.draw.pipeline)
  pass.setBindGroup(0, groups.args, offset)
  pass.dispatchWorkgroups(1)
}

/** Chunk `c`'s raster: one drawIndirect a tier of the first `count` of `tiers`, of its pairs, into
 *  the page-sized dummy `target`, then the patches of the pairs the tessellation took, if it runs. Encoded directly: each chunk is its own pass between its compute passes, and a bundle
 *  of its commands would cost a key and `executeBundles` for the same backend commands. */
function encodeVsmChunkRaster(
  encoder: GPUCommandEncoder,
  label: string,
  [tiers, count]: readonly [readonly PreparedPipeline<GPURenderPipeline>[], number],
  target: GPUTextureView,
  pageGroup: GPUBindGroup,
  raster1: GPUBindGroup,
  args: GPUBuffer,
  c: number,
  tessellation?: VsmShadowTessellation,
) {
  const raster = encoder.beginRenderPass({
    label,
    colorAttachments: [],
    depthStencilAttachment: {
      view: target,
      depthClearValue: 0,
      depthLoadOp: 'clear',
      depthStoreOp: 'discard',
    },
  })
  raster.setBindGroup(0, pageGroup)
  raster.setBindGroup(1, raster1)
  for (let t = 0; t < count; t++) {
    raster.setPipeline(tiers[t].get())
    raster.drawIndirect(args, (c * VSM_RENDER_ARGS_STRIDE_WORDS + VSM_RENDER_ARGS_DRAW + 4 * t) * 4)
  }
  // The patches of the displaced surfaces' pairs, which the tiers left undrawn.
  tessellation?.draw(raster)
  raster.end()
}

/** The tiers a frame draws: the corner tiers, and the voxel tiers too while the table holds a
 *  voxel row, once their raster and expand pipelines are compiled — asked the first frame that
 *  needs them (`ask`, the frames waiting for them), nothing compiled before. */
function tiersDrawn(ctx: VsmRenderContext, voxels: boolean) {
  if (!voxels) return VSM_RENDER_CORNER_TIERS
  let ready = true
  for (let t = VSM_RENDER_CORNER_TIERS; t < VSM_RENDER_TIERS; t++) {
    const raster = ctx.raster.tiers[t],
      expand = ctx.expands[t].prepared
    if (raster.ready && expand.ready) continue
    raster.ask()
    expand.ask()
    ready = false
  }
  return ready ? VSM_RENDER_TIERS : VSM_RENDER_CORNER_TIERS
}

/**
 * The candidates' kernel over the `rowCount` rows of `chunking`, the camera cut's world switch bound by
 * `world` (`vsmWorldGroup`), then, for each of its `passes` — one at least, the maps being some
 * (`encodeVsmRender`) —, its lights' views and, for each of its `chunks` — one at least, the rows being some —,
 * its compute pass (the cull and the expand) and its raster pass. The candidates and the first
 * pass's views open its chunk 0's pass: their dispatches read what theirs wrote, as a following
 * pass would, and no command of the encoder lies between them. A later pass lists its own views
 * (`encodeVsmViews`) once the count of the one before is cleared, and takes its chunks' slots after
 * the pass before's; the candidates are the frame's, the rows being one list for every view.
 */
export function vsmEncodeChunks(
  encoder: GPUCommandEncoder,
  ctx: VsmRenderContext,
  groups: RasterTables,
  world: GPUBindGroup,
  pageGroup: GPUBindGroup,
  args: GPUBuffer,
  {
    rowCount,
    chunks,
    passes,
    lights,
  }: Pick<VsmRenderChunking, 'rowCount' | 'chunks' | 'passes' | 'lights'>,
  voxels = false,
  tessellation?: VsmShadowTessellation,
) {
  const tiers = tiersDrawn(ctx, voxels),
    target = [ctx.raster.tiers, tiers] as const
  for (let p = 0; p < passes.length; p++) {
    // The views' and the runs' counters, the pass before's cleared.
    if (p) encoder.clearBuffer(ctx.buffers.counts!, VSM_RENDER_COUNT_VIEWS * 4, 8)
    for (let c = 0; c < chunks; c++) {
      const slot = vsmChunkSlot(chunks, p, c),
        each = ctx.passes.chunk(slot)
      tessellation?.begin(encoder)
      const pass = encoder.beginComputePass(each.cullPass)
      // A pass opens with its views, the frame's first with the candidates before them.
      if (!c) {
        if (!p) {
          const candidates = ctx.candidates.pipeline
          encodeVsmCandidates(pass, candidates, groups.cand, world, rowCount)
        }
        encodeVsmViews(pass, ctx, groups.chunk, each.offset, lights)
      }
      encodeVsmChunkCull(pass, ctx, groups.chunk, args, slot, each.offset, tiers)
      // The pairs the chunk listed are cut into patches, to be drawn by its raster pass.
      if (tessellation) tessellation.compute(pass, ctx.groups!, each.offset)
      pass.end()
      // The non-cluster raster: one page viewport, atomicMax into the pool.
      encodeVsmChunkRaster(
        encoder,
        each.raster,
        target,
        ctx.target,
        pageGroup,
        groups.raster1,
        args,
        slot,
        tessellation,
      )
    }
  }
}

/** The chunk groups and the expand's: `expand0` the VSM tables', `expand1` the lists' at the
 *  chunk's dynamic offset. */
export interface RasterChunkGroups extends VsmChunkGroups {
  expand0: GPUBindGroup
  expand1: GPUBindGroup
}

/** The raster's groups of a frame set (`renderGroups`): the candidates', the chunk groups and the
 *  raster's. */
export interface RasterTables {
  cand: GPUBindGroup
  chunk: RasterChunkGroups
  raster1: GPUBindGroup
}

/** The raster's groups over the tables of `res.current` and `ctx.groups` (`vsmPerFrameSet`). */
function rasterTables(res: VsmResources, ctx: VsmRenderContext): RasterTables {
  const { device } = ctx,
    groups = ctx.groups!
  return {
    cand: groups.cand,
    chunk: {
      views0: device.createBindGroup({
        layout: ctx.views.groups[0],
        entries: vsmBindGroupEntries(res, VSM_RENDER_VIEWS_SPECS),
      }),
      views1: groups.views1,
      cull0: device.createBindGroup({
        layout: ctx.cull.groups[0],
        entries: vsmBindGroupEntries(res, VSM_RENDER_CULL_SPECS),
      }),
      cull1: groups.cull1,
      expand0: device.createBindGroup({
        layout: ctx.expands[0].groups[0],
        entries: vsmBindGroupEntries(res, VSM_RENDER_EXPAND_SPECS),
      }),
      expand1: groups.expand1,
      args: groups.args,
    },
    raster1: device.createBindGroup({
      layout: ctx.raster.layout1,
      entries: [
        ...sequentialEntries([{ buffer: groups.pairs }]),
        ...vsmBindGroupEntries(res, VSM_RENDER_RASTER_VERTEX_SPECS),
        ...vsmBindGroupEntries(res, VSM_RENDER_RASTER_FRAGMENT_SPECS),
      ],
    }),
  }
}

/**
 * The raster's groups this frame: those over the scene's rows and the lists (`ctx.groups`) made
 * again only when one of them moved, those over the VSM tables once a frame set (`rasterTables`).
 */
export function renderGroups(ctx: VsmRenderContext, res: VsmResources, scene: VsmRenderScene) {
  const lists = ctx.buffers as Required<VsmRenderContext['buffers']>
  if (vsmSceneRowsMoved(ctx.bound, scene, lists)) ctx.groups = undefined
  if (!ctx.groups) {
    const chunk = vsmChunkListGroups(ctx.device, ctx, ctx.candidates.groups[0], scene, lists)
    ctx.groups = {
      ...chunk,
      expand1: vsmBufferGroup(ctx.device, ctx.expands[0].groups[1], [
        chunk.params,
        lists.cmds,
        lists.counts,
        lists.pairs,
        lists.order,
      ]),
    }
  }
  return vsmPerFrameSet(ctx.tables, res, rasterTables, ctx, ctx.groups)
}
