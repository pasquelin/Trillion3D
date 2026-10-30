import { layersDepth, layersSize } from '../reducedView.ts'
import { foldOitDepth, foldedDepthPublished } from '../objectShadow/objectShadowSelf.ts'
import { foldsDepth as readFoldsDepth } from '../../gpu/core/objectShadowRead.ts'
import { depthFoldReady } from '../objectShadow/objectShadowDepthFold.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { drawFullscreenTriangle } from '../../gpu/shader/fullscreenTriangle.ts'
import { heldColour } from '../../gpu/core/heldAttachment.ts'
import {
  OIT_PASS_SEPARATE,
  oitSampleCount,
  readOrderIndependentTranslucencySetting as read,
} from '../../../../sdk-core/src/contracts/orderIndependentTranslucencyOptions.ts'
import { OIT_COLLECT_PASS, OIT_COMBINE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { blendDepth, layersFeedback } from '../drawColour.ts'
import type { RankedPipelines } from '../stagePipelines.ts'
import type { OitPipelines } from './oitPipelines.ts'
import { copyOitPixel, oitCursorWord } from './oitDebug.ts'
import { OIT_CLEAR_BYTES, OIT_GROUP } from './oitLayout.ts'
import {
  clearOitDemand,
  copyOitDemand,
  disposeOit,
  askOitBuffers,
  oitBuffersOf,
  oitCombinePipelines,
  oitCombineCompiled,
  oitPassGroups,
  type OitBuffers,
} from './oitResources.ts'

/**
 * THE SORTED TRANSLUCENCY OF A DRAW OF THE LAYERS (`drawBlendPass`): the layers of the modes the pixels sort are not blended into the
 * translucency target with the others but collected, each fragment with its light and transmittance, in the buffer of the image
 * (`oitResources.ts`), by a pass of their own (`oitWgsl.ts`); a pass over the target then composes them front to back over what the
 * blends drew (`oitCombine`), the way the sorted layers of the reference are composed once the translucent pass is drawn. A draw whose
 * pipelines are not compiled yet, a device that cannot bind the buffer, a display-filtered image, or the setting off draws the layers blended, as the engine
 * does without the sorting.
 */
interface OitDraw {
  readonly buffers: OitBuffers
  readonly pipelines: OitPipelines
  /** The groups of the pass, on its own parameters' buffer (`oitPassGroups`): each pass of an image reads its own. */
  readonly collect: GPUBindGroup
  readonly combine: GPUBindGroup
  /** The pixel whose figures the debug asks (`oitCursorWord`), worked out once with the draw. */
  readonly cursor: number
}

/** The pass that collects attaches no colour: the request in the second slot where the pipelines write it. */
const collectTargets: (GPURenderPassColorAttachment | null)[] = [null, null]
const COLLECT: GPURenderPassDescriptor = {
  label: OIT_COLLECT_PASS,
  colorAttachments: collectTargets,
  depthStencilAttachment: blendDepth,
}
const combineColour = heldColour({ loadOp: 'load', storeOp: 'store' })
const COMBINE: GPURenderPassDescriptor = {
  label: OIT_COMBINE_PASS,
  colorAttachments: [combineColour],
}

/** Whether the programs read the depth they test against from the packed table (`foldOitDepth`), the device sparing no texture for it. */
const foldsDepth = (rt: WebgpuPagesRuntime) =>
  readFoldsDepth(rt.vis.blendPipelines?.objectShadowRead)

/** Whether the sorting is asked now: the run-time switch on, the separate translucency among the passes (every layer of the engine is drawn apart from the lit image). */
const oitAsked = (rt: WebgpuPagesRuntime) =>
  read(rt, 'oitSortedPixelsEnable') && (read(rt, 'oitPassType') & OIT_PASS_SEPARATE) !== 0

/**
 * At a frame's entry, the sorted translucency's first buffers asked of the device where the image will sort (`prepareOit`'s conditions that are known before the draw: the setting, the
 * stage compiled, a layer among the items, the targets made), so the frame that discovers the need is held on the answer (`deviceAnswer`) like those after it. The display filter is
 * known at the draw alone: the buffers asked for an image it filters are kept for the next one that sorts.
 */
export function askOit(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu } = rt
  if (!oitAsked(rt) || !rt.vis.blendPipelines?.oit || !rt.blendState.blendGpu.length) return
  if (!gpu.translucency || !oitCombineCompiled(device)) return
  const [width, height] = gpu.translucency.extent
  if (width * height <= 1) return
  askOitBuffers(
    device,
    gpu,
    width * height,
    oitSampleCount(read(rt, 'oitMaxSampleCount')),
    rt.diag.engineDiagnostic,
  )
}

/**
 * Prepares the draw's sorting: the buffer for the targets' pixels (made again when their extent or the fragments kept change, or the pool is short of the demand counted), its parameters
 * written (the buffer is clear: the combination resets the words it reads, `encodeOit` the globals). None when the image does not sort now (the setting is off, or the layers are filtered by display layers),
 * the stage that collects is not in the program (`oit`), the combination is not compiled or the device cannot bind the buffer.
 */
export function prepareOit(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  oit: OitPipelines | undefined,
  filtered: boolean,
): OitDraw | undefined {
  // The setting off gives the buffer back; an image filtered by display layers keeps it for the next one that sorts.
  if (!oitAsked(rt)) {
    disposeOit(device, rt.gpu)
    return undefined
  }
  if (!oit || filtered || !oitCombineCompiled(device)) return undefined
  // The depth lies in the packed table: the layers are collected only once the pass that writes it is compiled (asked: the frame waits) and the table of the image holds its rows
  // (the same predicate `encodeOit` folds by), never without their depth test: else the layers stay in the blends' pass, none is lost.
  if (foldsDepth(rt) && !(depthFoldReady(device) && foldedDepthPublished(rt, device)))
    return undefined
  const [width] = layersSize(rt.gpu)
  // Laid out for the targets' extent: an image drawn smaller keeps the buffer, its pitch the width it draws at.
  const [extentWidth, extentHeight] = rt.gpu.translucency!.extent
  const buffers = oitBuffersOf(
    device,
    rt.gpu,
    encoder,
    extentWidth * extentHeight,
    oitSampleCount(read(rt, 'oitMaxSampleCount')),
    rt.diag.engineDiagnostic,
  )
  if (!buffers) return undefined
  const threshold = clamp(read(rt, 'oitTransmittanceThreshold'), 0, 1)
  const cursor = oitCursorWord(rt)
  const { collect, combine } = oitPassGroups(
    device,
    buffers,
    encoder,
    foldsDepth(rt) ? undefined : layersDepth(rt.gpu),
    width,
    threshold,
    cursor,
  )
  return { buffers, pipelines: oit, collect, combine, cursor }
}

/**
 * The pass that collects the sorted layers and the pass that composes them onto the translucency target; nothing, as an after-blend layer hook, where the draw sorts none (`sorted` none). `drawRuns` encodes the draws
 * of the runs `ranked` selects into the open pass (`drawBlendRuns`); returns the draws encoded.
 */
export function encodeOit(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  sorted: OitDraw | undefined,
  drawRuns: (pass: GPURenderPassEncoder, ranked: RankedPipelines) => number,
) {
  if (!sorted) return 0
  const { buffers, pipelines, collect, combine, cursor } = sorted
  const { gpu } = rt,
    [width, height] = layersSize(gpu)
  collectTargets[1] = rt.vis.writesFeedback ? layersFeedback(rt) : null
  blendDepth.view = layersDepth(gpu)
  // Where the depth is folded into the packed table, it is written there before the pass that tests against it.
  // The layers were left out of the blends' pass: no depth written, none collected.
  if (foldsDepth(rt) && !foldOitDepth(rt, device, encoder)) return 0
  clearOitDemand(encoder, buffers)
  const pass = encoder.beginRenderPass(COLLECT)
  pass.setViewport(0, 0, width, height, 0, 1)
  pass.setBindGroup(OIT_GROUP, collect)
  // The pixels sort the fragments by key: the order the draws are encoded in is free, the nearest layer first.
  const encoded = drawRuns(pass, pipelines.collects)
  pass.end()
  // Nothing collected: the buffer is as it was cleared, there is nothing to compose.
  if (encoded === 0) return 0
  combineColour.view = gpu.translucency!.colorView
  // One draw with dual-source blending, else the multiply then the add (`oitCombinePipelines`).
  for (const pipeline of oitCombinePipelines(device))
    drawFullscreenTriangle(encoder, COMBINE, pipeline.get(), combine, width, height)
  copyOitPixel(rt, device, encoder, buffers, cursor)
  copyOitDemand(encoder, buffers)
  // The combination reset the pixels' headers; the pass's count of nodes asked of the pool starts again from zero.
  encoder.clearBuffer(buffers.buffer, 0, OIT_CLEAR_BYTES)
  return encoded
}
