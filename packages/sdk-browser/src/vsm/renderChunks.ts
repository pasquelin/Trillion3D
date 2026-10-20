/**
 * THE RASTER'S CHUNKS ENCODED (`renderPass.ts`): its groups — over the scene's rows and the lists,
 * made again when one of them moved, and over the VSM tables once a frame set —, then the
 * candidates and, for each chunk, its cull and expand pass and its raster pass.
 */
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { VSM_RENDER_CULL_SPECS } from './renderCullWgsl.ts'
import {
  VSM_RENDER_ARGS_BIN,
  VSM_RENDER_ARGS_DRAW,
  VSM_RENDER_ARGS_STRIDE_WORDS,
  VSM_RENDER_ARGS_TIER_EXPAND,
} from './renderParamsWgsl.ts'
import type { PreparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { VSM_RENDER_EXPAND_SPECS } from './renderExpandWgsl.ts'
import { VSM_RENDER_VIEWS_SPECS } from './renderViewsWgsl.ts'
import {
  VSM_RENDER_RASTER_FRAGMENT_SPECS,
  VSM_RENDER_RASTER_VERTEX_SPECS,
} from './renderRasterWgsl.ts'
import { vsmBindGroupEntries, vsmPerFrameSet, type VsmResources } from './resources.ts'
import type { VsmChunkKernels } from './chunkKernels.ts'
import { vsmBufferGroup } from './passKit.ts'
import {
  encodeVsmCandidates,
  encodeVsmChunkCommands,
  vsmChunkListGroups,
  vsmSceneRowsMoved,
  type VsmChunkGroups,
} from './chunkGroups.ts'
import type { VsmRenderContext, VsmRenderScene } from './renderPass.ts'

/** Chunk `c`'s commands (`encodeVsmChunkCommands`), their bin by corner tier, then the expand of
 *  each tier over its commands, lowest first (marking jobs and the raster's pages), and the draws'
 *  arguments, in `pass`. */
function encodeVsmChunkCull(
  pass: GPUComputePassEncoder,
  kernels: VsmChunkKernels & Pick<VsmRenderContext, 'bin' | 'expands'>,
  groups: RasterChunkGroups,
  args: GPUBuffer,
  c: number,
  offset: readonly number[],
) {
  encodeVsmChunkCommands(pass, kernels, groups, args, c, offset)
  const at = (word: number) => (c * VSM_RENDER_ARGS_STRIDE_WORDS + word) * 4
  pass.setPipeline(kernels.bin.pipeline)
  pass.setBindGroup(0, groups.expand0)
  pass.setBindGroup(1, groups.expand1, offset)
  pass.dispatchWorkgroupsIndirect(args, at(VSM_RENDER_ARGS_BIN))
  for (let t = 0; t < kernels.expands.length; t++) {
    pass.setPipeline(kernels.expands[t].pipeline)
    pass.dispatchWorkgroupsIndirect(args, at(VSM_RENDER_ARGS_TIER_EXPAND + 3 * t))
  }
  pass.setPipeline(kernels.args.draw.pipeline)
  pass.setBindGroup(0, groups.args, offset)
  pass.dispatchWorkgroups(1)
}

/** Chunk `c`'s raster: one drawIndirect a corner tier of its pairs into the page-sized dummy
 *  `target`. Encoded directly: each chunk is its own pass between its compute passes, and a bundle
 *  of its commands would cost a key and `executeBundles` for the same backend commands. */
function encodeVsmChunkRaster(
  encoder: GPUCommandEncoder,
  label: string,
  tiers: readonly PreparedPipeline<GPURenderPipeline>[],
  target: GPUTextureView,
  pageGroup: GPUBindGroup,
  raster1: GPUBindGroup,
  args: GPUBuffer,
  c: number,
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
  for (let t = 0; t < tiers.length; t++) {
    raster.setPipeline(tiers[t].get())
    raster.drawIndirect(args, (c * VSM_RENDER_ARGS_STRIDE_WORDS + VSM_RENDER_ARGS_DRAW + 4 * t) * 4)
  }
  raster.end()
}

/**
 * The candidates' kernel over `rowCount` rows, then, for each of `chunks` — one at least, the rows
 * being some (`encodeVsmRender`) —, its compute pass (the cull and the expand) and its raster
 * pass. The candidates open chunk 0's pass: its dispatches read what theirs wrote, as a following
 * pass would, and no command of the encoder lies between them.
 */
export function vsmEncodeChunks(
  encoder: GPUCommandEncoder,
  ctx: VsmRenderContext,
  groups: RasterTables,
  pageGroup: GPUBindGroup,
  args: GPUBuffer,
  rowCount: number,
  chunks: number,
  mapCount: number,
) {
  const opening = ctx.passes.chunk(0),
    first = encoder.beginComputePass(opening.cullPass)
  encodeVsmCandidates(
    first,
    ctx.candidates.pipeline,
    groups.cand,
    ctx,
    groups.chunk,
    rowCount,
    mapCount,
  )
  for (let c = 0; c < chunks; c++) {
    const each = ctx.passes.chunk(c)
    const pass = c ? encoder.beginComputePass(each.cullPass) : first
    encodeVsmChunkCull(pass, ctx, groups.chunk, args, c, each.offset)
    pass.end()
    // The non-cluster raster: one page viewport, atomicMax into the pool.
    encodeVsmChunkRaster(
      encoder,
      each.raster,
      ctx.raster.tiers,
      ctx.target,
      pageGroup,
      groups.raster1,
      args,
      c,
    )
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
