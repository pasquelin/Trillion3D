import { wantsSubsurface } from '../../materials/surface/subsurface.ts'
import { forgetCapturedImage } from '../backend/state/capture.ts'
import { wantsPhysicalLobes } from './lobesTarget.ts'
import {
  DEPTH_FORMAT,
  DISPLAY_FORMAT,
  FEEDBACK_FORMAT,
  hdrTargetDescriptor,
} from '../../scene/targetFormats.ts'
import { createSurfaceBuffer } from '../../materials/surface/surfaceAllocation.ts'
import { createBackdrop, holdsRefraction } from '../../blend/transparent/transmission.ts'
import { createTranslucency } from '../../blend/translucency.ts'
import { askComposePipelines, askLatePipeline } from '../../blend/translucencyCompose.ts'
import { createScreenReflection } from '../../lighting/reflections/gpu.ts'
import { dropAside, releaseSet } from './targetsSet.ts'
import { ensureTaaTargets } from '../../post/taa/prepare.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { displayApart, type FrameSize } from '../backend/state/renderScale.ts'
import { makeResponsive, wantsResponsive } from './responsiveTarget.ts'
import {
  drawsLateTranslucency,
  drawsTranslucency,
  lateImageSize,
  makesDisplayColor,
  sceneBlends,
} from './targetAllocation.ts'
import { BUDGET_EXCEEDED, GpuBudgetExceeded } from '../../gpu/core/ledgerBooks.ts'

/** True when the drawn view's frame targets in place are those of `size`, both sizes alike. */
export function targetsFit(rt: WebgpuPagesRuntime, size: FrameSize) {
  const { gpu, vis } = rt
  return (
    !!gpu.hdrTexture &&
    !!gpu.colorTexture === makesDisplayColor(rt, size) &&
    // The distortion's targets are full-size while the session holds a refracting surface.
    !!gpu.backdrop?.active === holdsRefraction(rt) &&
    // The translucency targets are full-size once the session holds a blend or a pool (`drawsTranslucency`).
    !!gpu.translucency?.active === drawsTranslucency(rt) &&
    // The late set of them is made once the session holds a layer drawn after the motion blur.
    !!gpu.translucency?.late === drawsLateTranslucency(rt) &&
    gpu.allocatedSize[0] === size.renderWidth &&
    gpu.allocatedSize[1] === size.renderHeight &&
    gpu.displaySize[0] === size.width &&
    gpu.displaySize[1] === size.height &&
    displayApart(gpu) === size.apart &&
    !!gpu.surfaces &&
    gpu.surfaces.hasSubsurface === wantsSubsurface(rt) &&
    // The lobes target is remade alone when it flips (`followLobes`), never the whole set.
    !!gpu.reflection &&
    // The front depth the blends write is full-size once the session holds a blend: one that joined
    // a session opened without remakes it (`sceneBlends`).
    gpu.reflection.front.wanted === sceneBlends(rt) &&
    !!vis.visTexture
  )
}

/** Releases the frame targets in place: none is drawn into or presented until the next are made.
 *  The view's temporal history goes with them — a capture draws in a view of its own —, unless
 *  `keepHistory`: the display's size stays, only the render size changes. Targets made
 *  aside for this view go too (`targetsAside.ts`): those in place are what they were to replace. */
export function releaseTargets(rt: WebgpuPagesRuntime, keepHistory = false) {
  const { gpu, vis, capture } = rt
  dropAside(rt)
  releaseSet(gpu, vis)
  forgetCapturedImage(capture)
  if (!keepHistory) gpu.temporal?.release()
}

/** The texture-feedback target, made while the pipelines write it (`./feedbackVariant.ts`, which
 *  makes and releases it in place): the material classes' shading stores its requests, the
 *  transparents draw theirs; only the A/B diagnostic copies it out. */
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
      GPUTextureUsage.STORAGE_BINDING |
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
    throw new GpuBudgetExceeded(`${BUDGET_EXCEEDED}: the Hi-Z pyramid`)
  return { allocation: targetAllocationOf(rt), destroy: () => releaseTargets(rt) }
}

/** What the drawn view's targets cost, as `frame-allocation` says it. */
export const targetAllocationOf = (rt: WebgpuPagesRuntime) => ({
  frame: rt.run.frame,
  width: rt.gpu.allocatedSize[0],
  height: rt.gpu.allocatedSize[1],
  allocationBytes: rt.gpu.targetBytes,
  captureAllocationBytes: rt.capture.captureAllocationBytes,
  surfaceVersion: 1,
})

/** The maker of a texture of the render size under a label, or of another extent and usage. */
const targetMaker =
  (device: GPUDevice, width: number, height: number, usage: GPUTextureUsageFlags) =>
  (
    label: string,
    format: GPUTextureFormat,
    targetUsage = usage,
    extent: GPUExtent3DDict = { width, height },
  ) =>
    device.createTexture({ label, size: extent, format, usage: targetUsage })

type TargetMaker = ReturnType<typeof targetMaker>

/** The display colour, the depth, the HDR target, the feedback, the surface buffer and the
 *  responsive targets, at the render size. */
function makeRenderTargets(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  size: FrameSize,
  target: TargetMaker,
  usage: GPUTextureUsageFlags,
) {
  const { gpu, vis } = rt,
    { renderWidth: width, renderHeight: height } = size
  gpu.colorTexture = makesDisplayColor(rt, size)
    ? target('Trillion3D display color', DISPLAY_FORMAT)
    : undefined
  gpu.depthTexture = target(
    'Trillion3D opaque depth',
    DEPTH_FORMAT,
    usage | GPUTextureUsage.COPY_DST,
  )
  // One of the two HDR targets that take turns, the other the reflection's (`createLitImage`).
  gpu.hdrTexture = device.createTexture(hdrTargetDescriptor(width, height))
  if (vis.writesFeedback) makeFeedbackTarget(rt, device, width, height)
  gpu.surfaces = createSurfaceBuffer(device, width, height, {
    subsurface: wantsSubsurface(rt),
    emissiveAo: vis.writesEmissiveAo,
    lobes: wantsPhysicalLobes(rt),
  })
  if (wantsResponsive(rt)) makeResponsive(rt, device, width, height)
}

/** The display's texture and the views of the display, depth and HDR targets. */
function makeDisplayTargets(
  rt: WebgpuPagesRuntime,
  size: FrameSize,
  target: TargetMaker,
  usage: GPUTextureUsageFlags,
) {
  const { gpu } = rt
  gpu.displayTexture = size.apart
    ? target('Trillion3D display', DISPLAY_FORMAT, usage, {
        width: size.width,
        height: size.height,
      })
    : gpu.colorTexture!
  gpu.displayView = gpu.displayTexture.createView()
  // The display colour's view, the display's own: apart, none is made (`makesDisplayColor`).
  gpu.colorView = gpu.colorTexture
    ? size.apart
      ? gpu.colorTexture.createView()
      : gpu.displayView
    : undefined
  gpu.depthView = gpu.depthTexture!.createView()
  gpu.hdrView = gpu.hdrTexture!.createView()
}

/** The backdrop, the translucency targets and the screen reflection, at the render size. */
function makeBlendTargets(rt: WebgpuPagesRuntime, device: GPUDevice, size: FrameSize) {
  const { gpu } = rt,
    { renderWidth: width, renderHeight: height } = size
  gpu.backdrop = createBackdrop(device, width, height, holdsRefraction(rt))
  const late = drawsLateTranslucency(rt)
  gpu.translucency = createTranslucency(
    device,
    width,
    height,
    drawsTranslucency(rt),
    late ? lateImageSize(size) : undefined,
  )
  if (gpu.translucency.active) askComposePipelines(device)
  if (late) askLatePipeline(device)
  gpu.reflection = createScreenReflection(
    device,
    width,
    height,
    sceneBlends(rt),
    rt.setup.reflectionStatistics,
  )
}

/**
 * Makes the frame targets of `size` in the runtime's groups, which hold none: every pass up to the
 * temporal resolve draws at the render size, the targets' or below it; the history and the display
 * colour are the display's. A new render size at the same display size keeps the temporal history,
 * which is the display's: the image goes on accumulating rather than restarting. `aside`: made
 * beside those in place, the temporal pass's own targets made at the swap (`ensureTaaTargets`).
 */
export function buildTargets(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  size: FrameSize,
  targetBytes: number,
  aside = false,
) {
  const { gpu, vis } = rt,
    { renderWidth: width, renderHeight: height } = size
  const sampled = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    usage = sampled | GPUTextureUsage.COPY_SRC
  const target = targetMaker(device, width, height, usage)
  makeRenderTargets(rt, device, size, target, usage)
  makeDisplayTargets(rt, size, target, usage)
  makeBlendTargets(rt, device, size)
  // Temporal history follows the display size, its render-resolution targets the render size.
  const allocationBytes = targetBytes + ensureTaaTargets(rt, size, aside)
  gpu.targetBytes = allocationBytes
  gpu.allocatedSize = [width, height]
  // Drawn at the targets' whole size until an image's entry says its scale (`drawFrameAt`).
  gpu.targetSize = [width, height]
  gpu.displaySize = [size.width, size.height]
  // Visibility targets too: one the device cannot make refuses the set, the mode kept. The
  // identifiers are written by the export of the visibility buffer, a compute pass
  // (`../../visibility/raster/export.ts`).
  vis.visTexture = target(
    'Trillion3D visibility',
    'r32uint',
    sampled | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
  )
  vis.visView = vis.visTexture.createView()
}
