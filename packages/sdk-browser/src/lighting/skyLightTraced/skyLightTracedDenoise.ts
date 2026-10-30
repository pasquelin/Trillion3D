import type { RayTracedSkyLightSettings } from '../../../../sdk-core/src/contracts/rayTracedSkyLightOptions.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { DIFFUSE_TARGETED_SAMPLES } from '../shadows/denoise/diffuseDenoiseWgsl.ts'
import { diffuseDenoiseReady, encodeDiffuseDenoise } from '../shadows/denoise/shadowDenoiseFrame.ts'
import {
  releaseSkyLightDenoise,
  skyLightDenoisedOf,
  type SkyLightTracedView,
} from './skyLightTracedState.ts'

/** The pixels of a pre-convolution's web: its centre and its six taps. */
const WEB_TAPS = 7
/** The pixels' spread of the first pre-convolution (it doubles with each). */
const KERNEL_SPREAD = 8
/** The share of the history's weight a quiet view reaches before it may rest: nine tenths. */
const SETTLED_SHARE = 0.9

/**
 * The weight an image adds to a pixel's sample at most: the rays a pixel casts, taken by each of the reconstruction's samples and again by each tap of every pre-convolution. It sets how many images
 * a quiet view is drawn again for while the history builds up to its weight (`DIFFUSE_TARGETED_SAMPLES`).
 */
export const skyLightImageWeight = (settings: RayTracedSkyLightSettings, samples: number) =>
  Math.max(samples, 1) *
  settings.rayTracedSkyLightDenoiserReconstructionSamples *
  WEB_TAPS ** settings.rayTracedSkyLightDenoiserPreConvolution

/** The images a quiet view is drawn again for while the sky light's denoiser accumulates, at `imageWeight` a pixel an image. */
export const skyLightSettlingImages = (imageWeight: number) =>
  Math.ceil(SETTLED_SHARE * DIFFUSE_TARGETED_SAMPLES * (1 / Math.max(imageWeight, 1)))

/** What the denoiser gives back: the texture holding the sky light's mean colour at the full resolution (none where the rays stand), and whether the result accumulates over the images (the view is drawn again until its history settles). */
export interface SkyLightDenoised {
  readonly view: GPUTextureView | undefined
  readonly accumulates: boolean
}

/**
 * THE DENOISER OF THE SKY LIGHT, right after the trace wrote `view.light` (the light, with the share of the rays that hit in its alpha) and `view.open` (the distance of the hits, the rays a pixel): the
 * diffuse signal of the shadow denoiser's frame (`../shadows/denoise/diffuseDenoiseWgsl.ts`) runs on them: the reconstruction up to the full resolution from the rays' grid, the pre-convolutions, the
 * accumulation in time, the convolution of the history. Where the settings switch it off, or its passes are still compiling (the frames do not wait: the rays' own light is composited), the rays stand.
 */
export function encodeSkyLightDenoise(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  view: SkyLightTracedView,
  settings: RayTracedSkyLightSettings,
): SkyLightDenoised {
  const raw = { view: undefined, accumulates: false }
  if (!settings.rayTracedSkyLightDenoiser) {
    releaseSkyLightDenoise(rt.gpu, view)
    return raw
  }
  if (!diffuseDenoiseReady(rt)) return raw
  const [width, height] = rt.gpu.targetSize
  const result = skyLightDenoisedOf(view, width, height)
  const temporal = settings.rayTracedSkyLightDenoiserTemporalAccumulation
  encodeDiffuseDenoise(
    rt,
    encoder,
    cam,
    {
      reconstructionSamples: settings.rayTracedSkyLightDenoiserReconstructionSamples,
      preConvolution: settings.rayTracedSkyLightDenoiserPreConvolution,
      kernelSpread: KERNEL_SPREAD,
      temporalAccumulation: temporal,
      historyConvolutionSamples: settings.rayTracedSkyLightDenoiserHistoryConvolutionSamples,
      historyConvolutionSpread:
        settings.rayTracedSkyLightDenoiserHistoryConvolutionKernelSpreadFactor,
      upscale: view.upscale,
      turn: rt.run.frame % (view.upscale * view.upscale),
    },
    { light: view.lightView, hits: view.openView, result },
  )
  return { view: result, accumulates: temporal }
}
