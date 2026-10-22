import { environmentExposure } from '../../../../sdk-core/src/scene/core/environment.ts'
import { UNIT_EXPOSURE } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/**
 * THE EXPOSURE THE CPU KNOWS: what every reader of the exposure outside the composition uses — the
 * lighting parameters, the temporal pass's weights and history correction, the reflections'
 * ranges and the background a mirror shows, the display layers. A manual exposure is its number,
 * as it is. The automatic one is measured on the GPU, a frame at a time, and reaches the CPU a few
 * images late (`createExposureMeter`): until one has, 1. The composition itself does not read it:
 * it shows the image at the exposure the GPU measured for that very image, copied beside it, so the
 * lag is the readers' alone, which the temporal pass corrects by the ratio of one image's scale
 * to the last's. It is also the exposure every light of the next image is written multiplied by
 * (the pre-exposure, `pre.ts`).
 *
 * A view lit by no declared lamp is shown without exposure (`UNLIT_COMPOSITIONS`): nothing here
 * asks it any.
 */
export function appliedExposureOf(rt: Pick<WebgpuPagesRuntime, 'lights' | 'gpu'>) {
  const exposure = environmentExposure(rt.lights.store?.environment)
  return exposure === 'auto' ? rt.gpu.exposure?.last || UNIT_EXPOSURE : exposure
}

/**
 * The mean of the local exposure's gain over the view's histogram, the factor the pre-exposure
 * carries beside the exposure (`pre.ts`): measured on the GPU with the exposure and read back with
 * it, 1 until one has, where the local exposure does not run, and for a manual exposure, which
 * measures nothing.
 */
export const averageLocalExposureOf = (rt: Pick<WebgpuPagesRuntime, 'gpu'>) =>
  rt.gpu.exposure?.local ?? 1
