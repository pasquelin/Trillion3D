import type { RayTracedAmbientOcclusionSettings } from '../../../../../sdk-core/src/contracts/rayTracedAmbientOcclusionOptions.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import {
  encodeOcclusionDenoise,
  occlusionDenoiseReady,
  releaseOcclusionDenoise,
} from '../../shadows/denoise/shadowDenoiseFrame.ts'
import { OCCLUSION_TARGETED_SAMPLES } from '../../shadows/denoise/shadowDenoiseSpatialWgsl.ts'

/** The share of the history's limit the accumulation reaches before a view may rest: nine tenths (the horizon method's rule). */
const SETTLED_SHARE = 0.9

/** The images a quiet view is drawn again for while the denoiser accumulates: the history gains one sample an image (the denoiser takes the pixel's image as one sample) up to `OCCLUSION_TARGETED_SAMPLES`,
 *  and the history of a view that changed is within a tenth of that limit after this many. */
export const RAY_TRACED_AO_SETTLING_IMAGES = Math.ceil(SETTLED_SHARE * OCCLUSION_TARGETED_SAMPLES)

/**
 * THE DENOISER OF THE RAY-TRACED OCCLUSION (`denoiseRayTracedAo`), right after the pass that cast the rays into `occlusion` (red: the occlusion, green: the distance of the nearest blocker): the
 * result goes back into its red. Where the settings switch it off, or its passes are still compiling (the frames do not wait: the rays' own occlusion is lit), the rays stand. Returns whether the
 * result accumulates over the images (the view is drawn again until its history settles, `RAY_TRACED_AO_SETTLING_IMAGES`).
 */
export function denoiseRayTracedAo(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  options: RayTracedAmbientOcclusionSettings,
  occlusion: GPUTextureView,
) {
  if (!options.denoiser || options.samples <= 0) {
    releaseOcclusionDenoise(rt.gpu)
    return false
  }
  if (!occlusionDenoiseReady(rt)) return false
  encodeOcclusionDenoise(rt, encoder, cam, options, occlusion)
  return options.temporalAccumulation
}
