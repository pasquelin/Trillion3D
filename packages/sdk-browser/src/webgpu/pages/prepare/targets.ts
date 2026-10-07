import { wantsSubsurface } from '../../../scene/subsurface.ts'
import { wantsPhysicalLobes } from './lobesTarget.ts'
import { createScreenReflection, reflectionPlan } from '../../../reflections/gpu.ts'
import { DISPLAY_FORMAT, FEEDBACK_FORMAT, holds } from '../../../scene/surfaceBuffer.ts'
import { createSurfaceBuffer } from '../../../scene/surfaceAllocation.ts'
import { createBackdrop } from '../../transparent/transmission.ts'
import { dropAside, releaseSet } from './targetsSet.ts'
import { ensureTaaTargets } from '../../../taa/prepare.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { displayApart, type FrameSize } from '../state/renderScale.ts'
import { makeAsIsShare, wantsAsIsShare } from './asIsShareTarget.ts'
import { makesDisplayColor } from './targetAllocation.ts'

/** True when the drawn view's frame targets in place are those of `size`, both sizes alike. */
export function targetsFit(rt: WebgpuPagesRuntime, size: FrameSize) {
  const { gpu, vis } = rt,
    plan = reflectionPlan(rt),
    pyramid = gpu.reflection?.pyramid
  return (
    !!gpu.hdrTexture &&
    !!gpu.colorTexture === makesDisplayColor(rt, size) &&
    gpu.allocatedSize[0] === size.renderWidth &&
    gpu.allocatedSize[1] === size.renderHeight &&
    gpu.displaySize[0] === size.width &&
    gpu.displaySize[1] === size.height &&
    displayApart(gpu) === size.apart &&
    !!gpu.surfaces &&
    holds(gpu.surfaces, gpu.surfaces.subsurface, wantsSubsurface(rt)) &&
    // The lobes target is remade alone when it flips (`followLobes`), never the whole set.
    // Judged by the plan the targets were made from (`makeTargets`): a fit that asked otherwise
    // would remake them every image, and a prepare would never settle.
    gpu.reflection?.active === plan.active &&
    !!gpu.reflection?.history === plan.rough &&
    !!pyramid === plan.pyramid &&
    !!gpu.reflection?.mirror === plan.mirror &&
    !!pyramid?.radiance === plan.cone &&
    !!vis.visTexture
  )
}

/** Releases the frame targets in place: none is drawn into or presented until the next are made.
 *  The view's temporal history goes with them — a capture draws in a view of its own —, unless
 *  `keepHistory`: the display's size stays, only the render size changes (#1343). Targets made
 *  aside for this view go too (`targetsAside.ts`): those in place are what they were to replace. */
export function releaseTargets(rt: WebgpuPagesRuntime, keepHistory = false) {
  const { gpu, vis, capture } = rt
  dropAside(rt)
  releaseSet(gpu, vis)
  capture.capturedPixels = undefined
  capture.capturedRevision = -1
  if (!keepHistory) gpu.temporal?.release()
}

/** The texture-feedback target, made while the pipelines write it (`./feedbackVariant.ts`, which
 *  makes and releases it in place); only the A/B diagnostic copies it out. */
export function makeFeedbackTarget(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
) {
  rt.gpu.feedbackTexture = device.createTexture({
    label: 'Trillion3D texture feedback target',
    size: { width, height },
    format: FEEDBACK_FORMAT,
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      (rt.context.feedbackTargetAB ? GPUTextureUsage.COPY_SRC : 0),
  })
  rt.gpu.feedbackView = rt.gpu.feedbackTexture.createView()
}

/**
 * Makes the frame targets of `size`, of `targetBytes` before the history: what `targetGrant.ts`
 * runs under the device's out-of-memory check, the targets in place released first, the view's
 * Hi-Z pyramid brought to the render size. Returns what releases them again, and what they cost
 * (`frame-allocation`).
 */
export function makeTargets(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  size: FrameSize,
  targetBytes: number,
) {
  const { gpu, vis } = rt,
    { renderWidth: width, renderHeight: height } = size
  releaseTargets(
    rt,
    !!gpu.hdrTexture && gpu.displaySize[0] === size.width && gpu.displaySize[1] === size.height,
  )
  buildTargets(rt, device, size, targetBytes)
  // The view's pyramid is one of its targets (#1483): refused, the targets are, for memory.
  if (vis.gpuHiz && !vis.gpuHiz.resize(device, width, height))
    throw new Error('GPU_BUDGET_EXCEEDED: the Hi-Z pyramid')
  return { allocation: targetAllocationOf(rt), destroy: () => releaseTargets(rt) }
}

/** What the drawn view's targets cost, as `frame-allocation` says it. */
export const targetAllocationOf = (rt: WebgpuPagesRuntime) => ({
  frame: rt.run.frame,
  width: rt.gpu.allocatedSize[0],
  height: rt.gpu.allocatedSize[1],
  allocationBytes: rt.gpu.targetBytes,
  captureAllocationBytes: rt.capture.captureAllocationBytes,
  physicalVramBytes: null,
  surfaceVersion: 1,
})

/**
 * Makes the frame targets of `size` in the runtime's groups, which hold none: every pass up to the
 * temporal resolve draws at the render size, the targets' or below it; the history and the display
 * colour are the display's. A new render size at the same display size keeps the temporal history,
 * which is the display's: the image goes on accumulating rather than restarting.
 */
export function buildTargets(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  size: FrameSize,
  targetBytes: number,
) {
  const { gpu, vis, blendState } = rt,
    { renderWidth: width, renderHeight: height } = size
  const sampled = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    usage = sampled | GPUTextureUsage.COPY_SRC
  const target = (
    label: string,
    format: GPUTextureFormat,
    targetUsage = usage,
    extent: GPUExtent3DDict = { width, height },
  ) => device.createTexture({ label, size: extent, format, usage: targetUsage })
  gpu.colorTexture = makesDisplayColor(rt, size)
    ? target('Trillion3D display color', DISPLAY_FORMAT)
    : undefined
  gpu.depthTexture = target(
    'Trillion3D opaque depth',
    'depth32float',
    usage | GPUTextureUsage.COPY_DST,
  )
  gpu.hdrTexture = target('Trillion3D HDR lighting', 'rgba16float')
  if (vis.writesFeedback) makeFeedbackTarget(rt, device, width, height)
  gpu.surfaces = createSurfaceBuffer(device, width, height, {
    subsurface: wantsSubsurface(rt),
    emissiveAo: vis.writesEmissiveAo,
    lobes: wantsPhysicalLobes(rt),
  })
  if (wantsAsIsShare(rt)) makeAsIsShare(rt, device, width, height)
  gpu.displayTexture = size.apart
    ? target('Trillion3D display', DISPLAY_FORMAT, usage, {
        width: size.width,
        height: size.height,
      })
    : gpu.colorTexture!
  gpu.displayView = gpu.displayTexture.createView()
  // Apart, the water's word alone draws into a display colour: its own below the display's size,
  // the display's at it — the view shared, never the texture, which would make the targets the
  // display's (`displayApart`) —, none without water (`makesDisplayColor`).
  gpu.colorView = gpu.colorTexture
    ? size.apart
      ? gpu.colorTexture.createView()
      : gpu.displayView
    : blendState.transmissive > 0
      ? gpu.displayView
      : undefined
  gpu.depthView = gpu.depthTexture.createView()
  gpu.hdrView = gpu.hdrTexture.createView()
  const plan = reflectionPlan(rt)
  gpu.reflection = createScreenReflection(
    device,
    width,
    height,
    gpu.depthView,
    plan.active,
    plan.rough,
    plan.cone,
    plan.mirror,
  )
  gpu.backdrop = createBackdrop(device, width, height, blendState.transmissive > 0)
  // Temporal history follows the display size.
  const allocationBytes = targetBytes + ensureTaaTargets(rt, size.width, size.height)
  gpu.targetBytes = allocationBytes
  gpu.allocatedSize = [width, height]
  // Drawn at the targets' whole size until an image's entry says its scale (`drawFrameAt`).
  gpu.targetSize = [width, height]
  gpu.displaySize = [size.width, size.height]
  // Visibility targets too: one the device cannot make refuses the set, the mode kept.
  vis.visTexture = target('Trillion3D visibility', 'r32uint', sampled | GPUTextureUsage.COPY_SRC)
  vis.visView = vis.visTexture.createView()
}
