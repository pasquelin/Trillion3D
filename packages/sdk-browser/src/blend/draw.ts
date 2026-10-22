import { bindForwardReflection } from '../lighting/reflections/group.ts'
import { feedbackAttachment } from '../frame/prepare/attachments.ts'
import { blendEntries } from './identity.ts'
import { createBlendOverdraw } from './overdraw.ts'
import { countsBlendOverdraw } from '../diagnostic/gpuVariant.ts'
import type { BlendModePipelines, RankedPipelines, TransmitPipelines } from './stagePipelines.ts'
import type { DualPasses } from './pipelines.ts'
import type { ContractKey } from '../lighting/deferred/contractCuts.ts'
import { distortionCovers } from './distortionDrawn.ts'
import { noTransmissiveInView } from './expand/expansionFrame.ts'
import { DISPLAY_MASK_GROUP, type DisplayFilter } from './display/displayFilter.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { activeAsIsShare, blendShareTargets } from '../frame/prepare/asIsShareTarget.ts'
import type { ShareTargets } from './blendTargets.ts'
import { directLightResources } from '../frame/prepare/contractLight.ts'
import {
  allRuns,
  attached,
  blendDepth,
  companionColour,
  companionRuns,
  dualColour,
  fillAllColour,
  givenUpColour,
  reached,
  shareColour,
} from './drawColour.ts'
import {
  DISPLAY_MASK_PASS,
  BLEND_COMPANION_PASS,
  TRANSPARENTS_PASS,
} from '../diagnostic/stage/passLabels.ts'

/**
 * Bind group of a blend pass: vertex buffers, item records, atlases and lighting. An item reads its
 * quantized pages in the page cache, or the float pool for a geometry its pages carry unquantized,
 * so ALL items share this group.
 */
function blendBindGroup(rt: WebgpuPagesRuntime, device: GPUDevice) {
  return device.createBindGroup({
    layout: rt.vis.blendBindGroupLayout!,
    entries: (rt.blendState.identity.entries[0] ??= blendEntries(rt)),
  })
}

/**
 * Encodes slots `from` to `to` of the pass into an open render pass: one `drawIndirect` per SLOT,
 * and nothing else.
 *
 * The GPU ordered the pass and wrote each slot's argument (`runs.ts`); the CPU knows each slot's
 * pipeline and buffers without that order: a slot of the main class sets the main pipeline and the
 * paged group, an own slot sets its entry's, and the own entries' paint order is the one the CPU
 * ranked (`order/order.ts`), each slot's pipeline taken once a frame (`slotPipelines`). Draw primitives are rasterized instance by instance, in order: the paint
 * order is the one a draw per item gives — without the draws.
 *
 * The loop does no matrix product, no material read, no frustum test: the frustum verdict is the
 * GPU's (`verdict/verdictWgsl.ts`), which zeros the instances of what it rejects — an own entry wholly out
 * of view draws no instance, and a draw with no instance sets nothing.
 *
 * `pipelines` say what draws each rank; `options` (`BlendRuns`) what else the pass holds. Returns
 * the draws encoded.
 */
export function drawBlendRuns(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  pipelines: RankedPipelines,
  { filter, share = 0, reflected = true, nearFirst = false }: BlendRuns = {},
) {
  const { blendState } = rt,
    args = blendState.argsBuffer!
  if (reflected) bindForwardReflection(pass, rt)
  if (filter) pass.setBindGroup(DISPLAY_MASK_GROUP, filter.maskGroup)
  // The groups of the identity the frame named (`voidStaleBlendGroups`), not a draw slot.
  const held = blendState.identity.slot,
    group = (blendState.sharedGroups[held] ??= blendBindGroup(rt, device))
  // Nothing is offset per item: the record is read at the rank the vertex index carries, so the
  // group is set once for the whole list.
  pass.setBindGroup(0, group)
  let boundPipeline = -1,
    encoded = 0
  const base = blendState.planRegion.args * 4,
    ranks = blendState.slotPipelines
  const to = blendState.runCount
  for (let k = 0; k < to; k++) {
    const slot = nearFirst ? to - 1 - k : k
    const pipelineRank = ranks[slot]
    if (pipelines.skips?.(pipelineRank)) continue
    encoded++
    if (boundPipeline !== pipelineRank) {
      boundPipeline = pipelineRank
      // The blend pass compiles a mode first written after it was built (`pipelines.ts`).
      const pipeline = pipelines.at(boundPipeline, !!filter, share)
      if (!pipeline) throw new Error(`blend pipeline ${boundPipeline} was not built for the scene`)
      pass.setPipeline(pipeline)
    }
    pass.drawIndirect(args, base + slot * 16)
  }
  return encoded
}

/** What a pass drawing the runs holds besides their pipelines (`drawBlendRuns`): the display
 *  layers `filter` attached and its mask bound; the share targets attached (`share`,
 *  `ShareTargets`); the reflection group bound, but for a pass whose pipelines read none (`reflected`
 *  false: the front pass, the distortion); the slots near to far, against their paint order
 *  (`nearFirst`): a pass that writes depth and blends nothing (the front pass) then rejects early
 *  what lies behind. */
export type BlendRuns = {
  filter?: DisplayFilter
  share?: ShareTargets
  reflected?: boolean
  nearFirst?: boolean
}

/**
 * Encodes the forward transparent pass over the lit image, every translucent layer lit in forward
 * and composed in paint order, after the distortion was applied to the opaque scene
 * (`distortion.ts`): the blends in their modes, the transmissive layers under the dual blend where the device grants it and no
 * display layer is on, under its fallback otherwise. Under the dual blend the pass holds the HDR
 * target alone — WebGPU takes a dual blend on a single target only, and the translucency
 * writes the one scene colour —, every layer in it, the blends' feedback and share left to the
 * companion pass (`drawCompanion`). Virtual-texture feedback is opened by `feedbackAttachment`,
 * which alone knows whether a pass of the frame already wrote it; the function says whether it
 * opened a pass. `key`, the frame's lights' key (`directLightResources`, resolved here when not
 * given), picks the program (`createForwardVariants`).
 */
export function drawBlendPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  key?: Partial<ContractKey>,
): boolean {
  const { gpu, vis, blendState } = rt,
    filter = gpu.displayFilter?.active ? gpu.displayFilter : undefined
  // Nothing to encode without runs, or without the arguments the GPU wrote for them.
  if (!blendState.runCount || !blendState.argsBuffer) return false
  // Lit with the code the frame's lights need, on the opaque resolve's key (`pipelines.ts`), and
  // with lobe code while an item's surface carries a lobe (`physicalWgsl.ts`).
  const pipelines = vis.blendPipelines!.lit(key ?? directLightResources(rt), blendState.lobed)
  if (filter) drawDisplayMask(rt, device, encoder, filter, pipelines.mask)
  const share = activeAsIsShare(rt),
    targets = share ? blendShareTargets(rt) : 0
  // A debug view or the temporal pass turning the share on starts its compile (`reach.ts`).
  reached.share = targets
  reached.filtered = !!filter
  pipelines.reach(reached)
  // The dual blend's two passes only while a transmissive item may be in view
  // (`noTransmissiveInView`); else the one pass on every target, the transmissive slots — which
  // the verdict left without an instance — skipped (`DualPasses.blends`).
  const passes = filter ? undefined : pipelines.dualPasses,
    dual =
      passes && blendState.transmissive > 0 && !noTransmissiveInView(blendState)
        ? passes
        : undefined,
    drawn = passes && !dual ? passes.blends : pipelines
  // Diagnostic only: the counting variant opens an occlusion query around the pass.
  const overdraw = countsBlendOverdraw(rt.context?.diagnosticGpuVariant)
    ? (blendState.overdraw ??= createBlendOverdraw(device))
    : undefined
  if (dual) dualColour[0].view = gpu.hdrView!
  blendDepth.view = gpu.depthView!
  const pass = encoder.beginRenderPass({
    label: TRANSPARENTS_PASS,
    occlusionQuerySet: overdraw?.set,
    colorAttachments: dual ? dualColour : fillAllColour(rt, share, targets, filter),
    depthStencilAttachment: blendDepth,
  })
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1)
  overdraw?.begin(pass)
  allRuns.filter = filter
  allRuns.share = targets
  let encoded = dual
    ? drawBlendRuns(rt, device, pass, dual.colour)
    : drawBlendRuns(rt, device, pass, drawn, allRuns)
  overdraw?.end(pass)
  pass.end()
  overdraw?.after(encoder)
  if (dual) encoded += drawCompanion(rt, device, encoder, pipelines.transmission, dual)
  countBlendDraws(rt, encoded)
  return true
}

/**
 * The companion pass of the dual blend, the translucent layers drawn again into their own
 * targets: what the colour pass's single target leaves out — the tile rank each pixel asks of
 * the virtual textures, and the share the temporal pass or a debug view reads, at each layer's
 * coverage (`fsBlendCoverage`, `fsTransmitCoverage`), which composes in any order (`asIsShare.ts`).
 * The transmissive layers are left out where the distortion's accumulation wrote theirs
 * (`distortionCovers`). None where the frame writes neither. Returns the draws encoded.
 */
function drawCompanion(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  transmission: TransmitPipelines | undefined,
  dual: DualPasses,
) {
  const { gpu } = rt,
    share = activeAsIsShare(rt),
    targets = share ? blendShareTargets(rt) : 0,
    feedback = rt.vis.writesFeedback
  if (!share && !feedback) return 0
  companionColour[1] = feedback ? feedbackAttachment(rt) : null
  companionColour[2] = attached(shareColour, share?.view)
  companionColour[3] = attached(givenUpColour, targets === 2 ? share?.givenUpView : undefined)
  blendDepth.view = gpu.depthView!
  const pass = encoder.beginRenderPass({
    label: BLEND_COMPANION_PASS,
    colorAttachments: companionColour,
    depthStencilAttachment: blendDepth,
  })
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1)
  // The reflection group bound too: a shadow catcher's lights may read its depth pyramid.
  const companion = dual.companion(!distortionCovers(rt, transmission))
  companionRuns.share = targets
  const encoded = drawBlendRuns(rt, device, pass, companion, companionRuns)
  pass.end()
  return encoded
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
    label: DISPLAY_MASK_PASS,
    colorAttachments: [...Array<null>(mask.slot).fill(null), filter.maskAttachment()],
    depthStencilAttachment: { view: gpu.depthView!, depthReadOnly: true },
  })
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1)
  run.gpuDrawCalls += drawBlendRuns(rt, device, pass, mask)
  pass.end()
}

/** Frame counters of a transparent pass: draws, and the triangles its clusters submit. */
export function countBlendDraws(rt: WebgpuPagesRuntime, encoded: number) {
  const { run } = rt
  run.gpuDrawCalls += encoded
  run.blendDrawCalls += encoded
  run.blendSubmittedTriangles = run.blendPagedTriangles
}
