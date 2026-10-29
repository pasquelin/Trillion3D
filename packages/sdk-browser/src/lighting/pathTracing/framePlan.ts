import type { SettingValues } from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { PATH_TRACING_RULES } from '../../../../sdk-core/src/contracts/pathTracingOptions.ts'
import { clampLowWins } from '../../../../math/src/scalar/reals.ts'

/** The path tracer's settings of the view, as resolved. */
export type PathTracingSettings = SettingValues<typeof PATH_TRACING_RULES>

/** What the tracer holds from one image to the next. */
export interface PathTracingProgress {
  /** The samples gathered so far; 0 at the first image of a view that restarts. */
  iteration: number
  /** The mode (`pathTracingDenoiser`, 0 or 1) the denoiser had when it last ran. */
  lastDenoiserMode: number
  /** Whether a denoised image of the size of this view is held (the temporal stage needs one). */
  hasHistory: boolean
}

/** What one image of the path tracer does: the counts it works to, then the stages it runs, in order. */
export interface PathTracingFrame {
  maxSamples: number
  adaptive: boolean
  /** The levels of the error's mip chain: one more than the passes that build it. */
  varianceMips: number
  needsMoreRays: boolean
  denoise: boolean
  stages: PathTracingStage[]
}

/** A stage of the frame, in the order the image runs them. */
export type PathTracingStage =
  | 'clear'
  | 'adaptiveMask'
  | 'trace'
  | 'adaptiveErrorMips'
  | 'denoiserPrepass'
  | 'normalSpace'
  | 'spatialDenoiser'
  | 'temporalDenoiser'
  | 'display'

/** The levels of the error chain of a view of `size`: one more than the passes that build it, five at most. */
export const varianceLevels = (size: readonly [number, number]) =>
  clampLowWins(1 + Math.floor(Math.log2(Math.min(size[0], size[1]))), 1, 5)

/**
 * The image of a path-traced view, as the tracer orders it: clear what accumulates, the mask of the pixels adaptive sampling still traces
 * (from the second sample), the sample, the error's mip chain when samples were traced (adaptive sampling), the denoiser's prepass,
 * the denoiser itself when this is the last sample or, the accumulation having stopped, when the denoiser was just turned on (or at every image,
 * `pathTracingTemporalDenoiserMode` 2), and the display.
 */
export function planPathTracingFrame(
  settings: PathTracingSettings,
  progress: PathTracingProgress,
  viewSize: readonly [number, number],
): PathTracingFrame {
  const maxSamples = Math.max(settings.pathTracingSamplesPerPixel, 1)
  const adaptive = settings.pathTracingExperimental && settings.pathTracingAdaptiveSampling
  const varianceMips = varianceLevels(viewSize)
  const needsMoreRays = progress.iteration < maxSamples
  const denoiserMode = settings.pathTracingDenoiser ? 1 : 0
  const online = settings.pathTracingTemporalDenoiserMode === 2
  const denoiseNow =
    denoiserMode !== 0 &&
    (progress.iteration + 1 === maxSamples ||
      (!needsMoreRays && denoiserMode !== progress.lastDenoiserMode))
  const denoise = denoiseNow || (denoiserMode !== 0 && online)
  const stages: PathTracingStage[] = []
  if (needsMoreRays) {
    stages.push('clear')
    if (adaptive && progress.iteration > 0) stages.push('adaptiveMask')
    stages.push('trace')
    if (adaptive) stages.push('adaptiveErrorMips')
  }
  if (denoiserMode !== 0) {
    stages.push('denoiserPrepass')
    if (denoise) {
      if (settings.pathTracingSpatialDenoiser) {
        if (settings.pathTracingDenoiserNormalSpace !== 0) stages.push('normalSpace')
        stages.push('spatialDenoiser')
      }
      if (settings.pathTracingTemporalDenoiser && progress.hasHistory)
        stages.push('temporalDenoiser')
    }
  }
  stages.push('display')
  return { maxSamples, adaptive, varianceMips, needsMoreRays, denoise, stages }
}
