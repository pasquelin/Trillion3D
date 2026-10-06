import { feedbackAttachment } from '../pages/prepare/attachments.ts'
import { blendEntries } from './identity.ts'
import { createBlendOverdraw } from './overdraw.ts'
import { countsBlendOverdraw } from '../../diagnostic/gpuVariant.ts'
import type { BlendGpuItem } from './state.ts'
import type { BlendModePipelines, RankedPipelines } from './stagePipelines.ts'
import type { ContractKey } from '../../lighting/deferred/contractVariants.ts'
import { planItem, planPipeline } from './plan.ts'
import { itemKept } from './expandCpu.ts'
import { routedFilter, type DisplayFilter } from './displayFilter.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { activeAsIsShare } from '../pages/prepare/asIsShareTarget.ts'
import { directLightResources } from '../pages/prepare/lightResources.ts'

/**
 * Bind group of a blend pass: vertex buffers, item records, atlases and lighting. A paged item
 * reads its quantized pages in the page cache, or the concatenated geometry of a cache without
 * them, so ALL paged items share this group; an unpaged item carries its own buffers and keeps
 * its own.
 */
function blendBindGroup(rt: WebgpuPagesRuntime, device: GPUDevice, item: BlendGpuItem | undefined) {
  return device.createBindGroup({
    layout: rt.vis.blendBindGroupLayout!,
    entries: item
      ? blendEntries(rt, item)
      : (rt.blendState.identity.entries[0] ??= blendEntries(rt)),
  })
}

/**
 * Encodes the slots of a pass into an open render pass: one `drawIndirect` per SLOT, and nothing
 * else.
 *
 * The GPU ordered the pass and wrote each slot's argument (`runs.ts`); the CPU knows each slot's
 * pipeline and buffers without that order: a slot of the main class sets the main pipeline and the
 * paged group, an own slot sets its entry's, and the own entries' paint order is the one the CPU
 * ranked (`order.ts`). Draw primitives are rasterized instance by instance, in order: the paint
 * order is the one a draw per item gives — without the draws.
 *
 * The loop does no matrix product, no material read, no frustum test: an own entry wholly out of
 * view is not encoded at all, as it was not per item; a main slot holds too many entries to query
 * one by one — the GPU zeros their instances, and a draw with no instance sets nothing.
 *
 * `slice` says which pass is encoded — blends, or the water surfaces — and `pipelines` what
 * draws it, with the display layers `filter` attached and its mask bound; the bind groups are the
 * same, and they are the blend pass's. Returns the draws encoded.
 */
export function drawBlendRuns(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  slice: number,
  pipelines: RankedPipelines,
  filter?: DisplayFilter,
  share = false,
) {
  const { blendState } = rt,
    items = blendState.blendGpu,
    seeds = blendState.seeds[slice],
    ownSeeds = blendState.ownSeeds[slice],
    slotOwns = blendState.slotOwns[slice],
    main = blendState.mainPipeline[slice],
    count = blendState.runCount[slice],
    args = blendState.argsBuffer!
  if (rt.gpu.reflection) pass.setBindGroup(1, rt.gpu.reflection.group)
  if (filter) pass.setBindGroup(2, filter.maskGroup)
  // The groups of the identity the frame named (`voidStaleBlendGroups`), not a draw slot.
  const held = blendState.identity.slot,
    pagedGroup = (blendState.pagedGroups[held] ??= blendBindGroup(rt, device, undefined))
  let boundPipeline = -1,
    boundGroup: GPUBindGroup | undefined,
    encoded = 0
  const base = blendState.planRegions[slice].args * 4
  for (let slot = 0; slot < count; slot++) {
    const own = slotOwns[slot]
    let pipelineRank = main,
      item: BlendGpuItem | undefined
    if (own >= 0) {
      const entry = seeds[ownSeeds[own]]
      if (!itemKept(blendState.keepPacked, planItem(entry))) continue
      pipelineRank = planPipeline(entry)
      item = items[planItem(entry)]
    }
    if (pipelines.skips?.(pipelineRank)) continue
    encoded++
    if (boundPipeline !== pipelineRank) {
      boundPipeline = pipelineRank
      // The blend pass compiles a mode first written after it was built (`pipelines.ts`).
      const pipeline = pipelines.at(boundPipeline, !!filter, share)
      if (!pipeline) throw new Error(`blend pipeline ${boundPipeline} was not built for the scene`)
      pass.setPipeline(pipeline)
    }
    const group =
      item && !item.paged
        ? ((item.groups ??= [])[held] ??= blendBindGroup(rt, device, item))
        : pagedGroup
    // Nothing is offset per item: the record is read at the rank the vertex index carries, so the
    // group is set once for the whole list, and again only for an unpaged item's own buffers.
    if (group !== boundGroup) pass.setBindGroup(0, (boundGroup = group))
    pass.drawIndirect(args, base + slot * 16)
  }
  return encoded
}

/**
 * Encodes a forward transparent pass over the lit image: the blends, or — under a diagnostic
 * view or variant, which see it as one more blend — the transmission slice. Virtual-texture
 * feedback is opened by `feedbackAttachment`, which alone knows whether a pass of the frame
 * already wrote it; the function says whether it opened a pass. `key`, the frame's lights' key
 * (`directLightResources`, resolved here when not given), picks the program
 * (`createForwardVariants`).
 */
export function drawBlendPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  transmissive = false,
  key?: Partial<ContractKey>,
): boolean {
  const { gpu, vis, blendState } = rt,
    slice = transmissive ? 1 : 0,
    // The transmission slice routes through the mask the blends drew, if they drew one.
    filter = transmissive
      ? routedFilter(gpu.displayFilter)
      : gpu.displayFilter?.active
        ? gpu.displayFilter
        : undefined
  // Nothing to encode without runs, or without the arguments the GPU wrote for them.
  if (!blendState.runCount[slice] || !blendState.argsBuffer) return false
  // Lit with the code the frame's lights need, on the opaque resolve's key (`pipelines.ts`).
  const pipelines = vis.blendPipelines!.lit(key ?? directLightResources(rt))
  if (filter && !transmissive) drawDisplayMask(rt, device, encoder, filter, pipelines.mask)
  const share = activeAsIsShare(rt)
  // A debug view or the temporal pass turning the share on starts its compile (`reach.ts`).
  pipelines.reach({ share: !!share, filtered: !!filter })
  // Diagnostic only: the counting variant opens an occlusion query around the pass.
  const overdraw = countsBlendOverdraw(rt.context?.diagnosticGpuVariant)
    ? (blendState.overdraw ??= createBlendOverdraw(device))
    : undefined
  const pass = encoder.beginRenderPass({
    label: transmissive ? 'Trillion3D transmission' : 'Trillion3D transparents',
    occlusionQuerySet: overdraw?.set,
    colorAttachments: [
      {
        view: vis.visEnabled && gpu.hdrView ? gpu.hdrView : gpu.colorView!,
        loadOp: 'load',
        storeOp: 'store',
      },
      // Virtual-texture feedback, opened by the first pass that writes it, while the pipelines do.
      ...(rt.vis.writesFeedback ? [feedbackAttachment(rt)] : []),
      // The share a debug view or the temporal pass reads; an empty slot otherwise.
      share ? { view: share.view, loadOp: 'load', storeOp: 'store' } : null,
      // The display layers of an image whose blends filter (`displayFilter.ts`).
      ...(filter ? filter.attachments() : []),
    ],
    depthStencilAttachment: { view: gpu.depthView!, depthReadOnly: true },
  })
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1)
  overdraw?.begin(pass, transmissive)
  const encoded = drawBlendRuns(rt, device, pass, slice, pipelines, filter, !!share)
  overdraw?.end(pass)
  pass.end()
  overdraw?.after(encoder)
  countBlendDraws(rt, encoded, transmissive)
  return true
}

/** The display mask: the blends' filtering surfaces alone, depth-tested, before the blend pass. */
function drawDisplayMask(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  filter: DisplayFilter,
  mask: BlendModePipelines['mask'],
) {
  const { gpu, run } = rt
  const pass = encoder.beginRenderPass({
    label: 'Trillion3D display mask',
    colorAttachments: [...Array<null>(mask.slot).fill(null), filter.maskAttachment()],
    depthStencilAttachment: { view: gpu.depthView!, depthReadOnly: true },
  })
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1)
  run.gpuDrawCalls += drawBlendRuns(rt, device, pass, 0, mask)
  pass.end()
}

/** Frame counters of a transparent pass: draws, and the unpaged triangles it submits. */
export function countBlendDraws(rt: WebgpuPagesRuntime, encoded: number, transmissive: boolean) {
  const { run, blendState } = rt
  run.gpuDrawCalls += encoded
  run.blendDrawCalls += encoded
  run.blendUnpagedTriangles += transmissive
    ? blendState.transmissionTriangles
    : blendState.blendTriangles
  run.blendSubmittedTriangles = run.blendPagedTriangles + run.blendUnpagedTriangles
}
