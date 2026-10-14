/**
 * THE TRANSMISSION'S BIN ENCODED (`transmissionPass.ts`): its lists, parameters and groups — over
 * the scene's rows, the lists and the transmission, made again when one of them moved, and over the
 * VSM tables once a frame set, the opaque raster's mechanism (`renderChunks.ts: renderGroups`) —,
 * then the candidates and, per chunk, the cull, its commands' redrawn pages and the bin.
 */
import {
  VSM_RENDER_ARGS_EXPAND,
  VSM_RENDER_ARGS_STRIDE_WORDS,
  VSM_RENDER_CULL_SPECS,
} from './renderCullWgsl.ts'
import {
  encodeVsmCandidates,
  encodeVsmChunkCommands,
  vsmChunkListGroups,
  vsmSceneRowsMoved,
} from './chunkGroups.ts'
import { vsmBufferGroup } from './passKit.ts'
import { vsmEnsureLists } from './chunkLists.ts'
import { vsmWriteChunkParams } from './chunkParams.ts'
import { vsmBindGroupEntries, vsmPerFrameSet, type VsmResources } from './resources.ts'
import type { VsmRenderScene } from './renderPass.ts'
import { VSM_TRANSMISSION_PAGES_SPECS } from './transmissionWgsl.ts'
import { TRANSMISSION_LABEL, type VsmTransmission } from './transmissionMade.ts'
import type { VsmTransmissionContext } from './transmissionContext.ts'
import type { BinPlan } from './transmissionBinPlan.ts'

/** The chunk groups over the scene's rows, the lists and the transmission alone
 *  (`VsmTransmissionContext.lists`). */
export interface ChunkLists {
  trans: VsmTransmission
  cand: GPUBindGroup
  cull1: GPUBindGroup
  args: GPUBindGroup
  pages1: GPUBindGroup
}

/** The chunk groups over the tables of `res.current` (`VsmTransmissionContext.tables`). */
export interface ChunkTables {
  cull0: GPUBindGroup
  pages0: GPUBindGroup
  bin1: GPUBindGroup
}

function chunkLists(
  ctx: VsmTransmissionContext,
  trans: VsmTransmission,
  bound: readonly unknown[],
): ChunkLists {
  const { device } = ctx
  const { params, counts, pairs, cand, cull1, args } = vsmChunkListGroups(
    device,
    ctx,
    ctx.candidates.groups[0],
    bound,
    [trans.uniform],
  )
  return {
    trans,
    cand,
    cull1,
    args,
    pages1: vsmBufferGroup(device, ctx.pages.groups[1], [
      params,
      ctx.buffers.cmds!,
      counts,
      pairs,
      trans.build,
      trans.uniform,
    ]),
  }
}

function chunkTables(res: VsmResources, ctx: VsmTransmissionContext): ChunkTables {
  const { device } = ctx,
    { trans } = ctx.lists!
  return {
    cull0: device.createBindGroup({
      layout: ctx.cull.groups[0],
      entries: vsmBindGroupEntries(res, VSM_RENDER_CULL_SPECS),
    }),
    pages0: device.createBindGroup({
      layout: ctx.pages.groups[0],
      entries: vsmBindGroupEntries(res, VSM_TRANSMISSION_PAGES_SPECS),
    }),
    bin1: vsmBufferGroup(device, ctx.bin.groups[1], [
      ctx.buffers.pairs!,
      res.current.projectionData,
      trans.uniform,
      trans.build,
    ]),
  }
}

/**
 * The chunk groups this frame: those over the scene's rows, the lists and the transmission
 * (`ctx.lists`) made again only when one of them moved, those over the VSM tables once a frame
 * set: the opaque raster's mechanism (`renderChunks.ts: renderGroups`).
 */
function chunkGroups(
  ctx: VsmTransmissionContext,
  trans: VsmTransmission,
  res: VsmResources,
  scene: VsmRenderScene,
) {
  const b = ctx.buffers as Required<VsmTransmissionContext['buffers']>
  const bound = ctx.bound.next
  bound[11] = trans.uniform
  bound[12] = trans.build
  bound[13] = trans.args
  if (vsmSceneRowsMoved(ctx.bound, scene, b, 3)) ctx.lists = undefined
  const lists = (ctx.lists ??= chunkLists(ctx, trans, bound))
  return { lists, tables: vsmPerFrameSet(ctx.tables, res, chunkTables, ctx, lists) }
}

/** The bin's lists, parameters and groups, its counters cleared: the encoder's part of the bin,
 *  before the transmission's pass opens. */
export function binLists(
  encoder: GPUCommandEncoder,
  ctx: VsmTransmissionContext,
  trans: VsmTransmission,
  res: VsmResources,
  scene: VsmRenderScene,
  plan: BinPlan,
) {
  const { params, views, counts, args } = vsmEnsureLists(ctx, TRANSMISSION_LABEL, plan.within.size!)
  vsmWriteChunkParams(ctx.device, scene.camera, params, views, plan.views, ctx.slots)
  encoder.clearBuffer(counts, 0, plan.within.size!.counts)
  return { args, ...chunkGroups(ctx, trans, res, scene) }
}

/** The blended rows' bin, in the chunks `plan` holds, in `pass`: candidates, then per chunk the
 *  cull, its commands' redrawn pages and the bin. */
export function encodeBin(
  pass: GPUComputePassEncoder,
  ctx: VsmTransmissionContext,
  scene: VsmRenderScene,
  plan: BinPlan,
  { args, lists, tables }: ReturnType<typeof binLists>,
) {
  encodeVsmCandidates(pass, ctx.candidates.pipeline, lists.cand, ctx, lists.args, plan.rowCount)
  const cull = { cull0: tables.cull0, cull1: lists.cull1, args: lists.args }
  for (let c = 0; c < plan.chunks; c++) {
    const { offset } = ctx.passes.chunk(c)
    encodeVsmChunkCommands(pass, ctx, cull, args, c, offset)
    // A group per command, as the expand's arguments: its pages, then its triangles.
    const at = (c * VSM_RENDER_ARGS_STRIDE_WORDS + VSM_RENDER_ARGS_EXPAND) * 4
    pass.setPipeline(ctx.pages.pipeline)
    pass.setBindGroup(0, tables.pages0)
    pass.setBindGroup(1, lists.pages1, offset)
    pass.dispatchWorkgroupsIndirect(args, at)
    pass.setPipeline(ctx.bin.pipeline)
    pass.setBindGroup(0, scene.pageGroup)
    pass.setBindGroup(1, tables.bin1)
    pass.dispatchWorkgroupsIndirect(args, at)
  }
}
