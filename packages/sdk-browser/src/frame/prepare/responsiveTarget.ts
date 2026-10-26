import { RESPONSIVE_BYTES, createResponsive } from '../../blend/responsive.ts'
import { RESPONSIVE_CLEAR_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { taaWanted } from '../backend/state/gpu.ts'

/** Whether the image has a responsive target, which its transparents write: a blended image whose
 *  temporal pass reads the responsiveness an item's surface carries (`responsive`). Any other scene
 *  draws and allocates no such target. */
export const wantsResponsive = (rt: WebgpuPagesRuntime) =>
  rt.blendState.blendGpu.length > 0 && rt.blendState.responsive && taaWanted(rt.gpu)

/** Whether this image's blend pass writes the responsiveness, which is then cleared first and the
 *  temporal analysis reads. */
export const writesResponsive = (rt: WebgpuPagesRuntime) =>
  !!rt.vis.blendPipelines && wantsResponsive(rt)

/** The responsive target at `width`×`height`: made with the targets or later. */
export function makeResponsive(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
) {
  rt.gpu.responsive = createResponsive(device, width, height)
}

/** The responsiveness the transparents blend into this image, when they write it. */
export const activeResponsive = (rt: WebgpuPagesRuntime) =>
  wantsResponsive(rt) ? rt.gpu.responsive : undefined

/** Releases the responsive target and its cost, when there is one. */
function releaseResponsive(rt: WebgpuPagesRuntime) {
  const { gpu } = rt
  if (!gpu.responsive) return
  const [width, height] = gpu.allocatedSize
  gpu.responsive.dispose()
  gpu.responsive = undefined
  gpu.targetBytes -= width * height * RESPONSIVE_BYTES
}

/**
 * Clears the responsiveness the transparents blend into this image, and returns it: the target
 * made with the targets, or one made at the first image that wants it and kept with them. An image
 * where they do not write it clears nothing and returns nothing; one that no longer wants it at all
 * (`wantsResponsive`, the temporal pass turned off) releases it.
 */
export function clearResponsive(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { gpu } = rt
  if (!wantsResponsive(rt)) releaseResponsive(rt)
  if (!writesResponsive(rt)) return undefined
  if (!gpu.responsive) {
    const [width, height] = gpu.allocatedSize
    gpu.targetBytes += width * height * RESPONSIVE_BYTES
    makeResponsive(rt, device, width, height)
  }
  gpu.responsive!.clear(encoder, RESPONSIVE_CLEAR_PASS)
  return gpu.responsive
}
