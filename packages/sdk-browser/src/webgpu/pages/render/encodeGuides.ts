import { families } from '../../../host/families.ts'
import type { EngineCamera } from '../../../camera/world.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/**
 * Whether this image draws guides, and the set's revision it draws: what `guidesMoved` compares
 * before holding a frame. Read before composition, which then leaves presentation to the copy
 * that follows the guide pass.
 */
export function guidesShown(rt: WebgpuPagesRuntime) {
  const guides = rt.context.guides
  if (!guides) return false
  rt.gpu.guideRevision = guides.revision
  return guides.visibleInstances() > 0
}

/** True when the page changed its guides since the last encoded image: a held frame would miss it. */
export const guidesMoved = (rt: WebgpuPagesRuntime) =>
  !!rt.context.guides && rt.context.guides.revision !== rt.gpu.guideRevision

const NO_JITTER = [0, 0] as const

/** The guide pass, made by the frame entry that first finds a guide shown, its code arrived — a
 *  world that shows none fetches none — and its pipeline asked there, the frame held on it
 *  (`../../frame/framePipelines.ts`). */
export function askGuidePass(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, context } = rt
  if (gpu.guides || !context.guides?.visibleInstances()) return
  // Their code, which a frame that shows one waits for (`../../../host/families.ts`).
  gpu.guides = families.guides.get()?.createWebgpuGuidePass(device)
}

/** The guide pass over the composed image (`createWebgpuGuidePass`). */
export function encodeWebgpuGuides(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu, context } = rt
  if (!context.guides || !gpu.displayView || !gpu.depthView || !gpu.guides) return
  // Over the display colour, at its size; the scene depth is the render one (`GUIDE_WGSL`).
  const { displayView, depthView, displaySize } = gpu
  // The jitter the scene depth was drawn with: that of the image when it accumulates.
  const frame = gpu.temporal?.frame
  const jitter = frame?.active ? frame.jitter : NO_JITTER
  const drawn = gpu.guides.encode(
    encoder,
    context.guides,
    displayView,
    depthView,
    cam,
    displaySize,
    rt.setup.pixelRatio(),
    jitter,
    gpu.targetSize,
  )
  if (drawn) rt.run.gpuDrawCalls++
}
