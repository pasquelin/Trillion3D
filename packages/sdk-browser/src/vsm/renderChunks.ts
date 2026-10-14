/**
 * THE RASTER'S CHUNKS ENCODED (`renderPass.ts`): its groups — over the scene's rows and the lists,
 * made again when one of them moved, and over the VSM tables once a frame set —, then the
 * candidates and, for each chunk, its cull and expand pass and its raster pass.
 */
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import {
  VSM_RENDER_ARGS_DRAW,
  VSM_RENDER_ARGS_EXPAND,
  VSM_RENDER_ARGS_STRIDE_WORDS,
  VSM_RENDER_CULL_SPECS,
  VSM_RENDER_EXPAND_SPECS,
} from './renderCullWgsl.ts'
import {
  VSM_RENDER_RASTER_FRAGMENT_SPECS,
  VSM_RENDER_RASTER_VERTEX_SPECS,
} from './renderRasterWgsl.ts'
import { vsmBindGroupEntries, vsmPerFrameSet, type VsmResources } from './resources.ts'
import type { VsmChunkKernels, vsmChunkPasses } from './chunkKernels.ts'
import {
  encodeVsmCandidates,
  encodeVsmChunkCommands,
  vsmChunkListGroups,
  vsmSceneRowsMoved,
  type VsmChunkGroups,
} from './chunkGroups.ts'
import type { VsmRenderContext, VsmRenderScene } from './renderPass.ts'

/** Chunk `c`'s commands (`encodeVsmChunkCommands`), then its expand (marking jobs and the raster's
 *  pages) and the draw's arguments, in `pass`. */
function encodeVsmChunkCull(
  pass: GPUComputePassEncoder,
  kernels: VsmChunkKernels,
  groups: VsmChunkGroups,
  args: GPUBuffer,
  c: number,
  offset: readonly number[],
) {
  encodeVsmChunkCommands(pass, kernels, groups, args, c, offset)
  pass.setPipeline(kernels.expand.pipeline)
  pass.setBindGroup(0, groups.expand0)
  pass.setBindGroup(1, groups.expand1, offset)
  pass.dispatchWorkgroupsIndirect(
    args,
    c * VSM_RENDER_ARGS_STRIDE_WORDS * 4 + VSM_RENDER_ARGS_EXPAND * 4,
  )
  pass.setPipeline(kernels.args.draw.pipeline)
  pass.setBindGroup(0, groups.args, offset)
  pass.dispatchWorkgroups(1)
}

/** Chunk `c`'s raster: one drawIndirect of its pairs into the page-sized dummy `target`. Encoded
 *  directly: each chunk is its own pass between its compute passes, and a bundle of its four
 *  commands would cost a key and `executeBundles` for the same four backend commands. */
function encodeVsmChunkRaster(
  encoder: GPUCommandEncoder,
  label: string,
  pipeline: GPURenderPipeline,
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
  raster.setPipeline(pipeline)
  raster.setBindGroup(0, pageGroup)
  raster.setBindGroup(1, raster1)
  raster.drawIndirect(args, c * VSM_RENDER_ARGS_STRIDE_WORDS * 4 + VSM_RENDER_ARGS_DRAW * 4)
  raster.end()
}

/**
 * The candidates' kernel over `rowCount` rows, then, for each of `chunks`, its compute pass (the
 * cull and the expand) and its raster pass. The candidates open chunk 0's pass: its dispatches read
 * what theirs wrote, as a following pass would, and no command of the encoder lies between them.
 */
export function vsmEncodeChunks(
  encoder: GPUCommandEncoder,
  ctx: VsmChunkKernels & {
    candidates: { pipeline: GPUComputePipeline }
    raster: { pipeline: GPURenderPipeline }
    target: GPUTextureView
  },
  passes: ReturnType<typeof vsmChunkPasses>,
  groups: { cand: GPUBindGroup; chunk: VsmChunkGroups; raster1: GPUBindGroup },
  pageGroup: GPUBindGroup,
  args: GPUBuffer,
  rowCount: number,
  chunks: number,
) {
  const opening = passes.chunk(0),
    first = encoder.beginComputePass(opening.cullPass)
  encodeVsmCandidates(first, ctx.candidates.pipeline, groups.cand, ctx, groups.chunk.args, rowCount)
  if (!chunks) first.end()
  for (let c = 0; c < chunks; c++) {
    const each = passes.chunk(c)
    const pass = c ? encoder.beginComputePass(each.cullPass) : first
    encodeVsmChunkCull(pass, ctx, groups.chunk, args, c, each.offset)
    pass.end()
    // The non-cluster raster: one page viewport, atomicMax into the pool.
    encodeVsmChunkRaster(
      encoder,
      each.raster,
      ctx.raster.pipeline,
      ctx.target,
      pageGroup,
      groups.raster1,
      args,
      c,
    )
  }
}

/** The raster's groups of a frame set (`renderGroups`): the candidates', the chunk groups and the
 *  raster's. */
export interface RasterTables {
  cand: GPUBindGroup
  chunk: VsmChunkGroups
  raster1: GPUBindGroup
}

/** The raster's groups over the tables of `res.current` and `ctx.groups` (`vsmPerFrameSet`). */
function rasterTables(res: VsmResources, ctx: VsmRenderContext): RasterTables {
  const { device } = ctx,
    groups = ctx.groups!
  return {
    cand: groups.cand,
    chunk: {
      cull0: device.createBindGroup({
        layout: ctx.cull.groups[0],
        entries: vsmBindGroupEntries(res, VSM_RENDER_CULL_SPECS),
      }),
      cull1: groups.cull1,
      expand0: device.createBindGroup({
        layout: ctx.expand.groups[0],
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
  ctx.groups ??= vsmChunkListGroups(ctx.device, ctx, ctx.candidates.groups[0], scene, lists)
  return vsmPerFrameSet(ctx.tables, res, rasterTables, ctx, ctx.groups)
}
