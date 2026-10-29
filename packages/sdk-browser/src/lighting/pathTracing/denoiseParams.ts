import type { PathTracingSettings } from './framePlan.ts'

/** The levels of the motion pyramid and the step between two levels the estimate visits. */
export const DN_MIPS = 7
export const DN_MIP_STEP = 2
/** The shifts tried at each level (a 5 by 5 window), the slices of four distances that hold them. */
export const DN_SLICES = 7
/** The scale that brings a CIE 2000 difference to the mean of the colour distance. */
export const DN_DELTA_E_SCALE = 0.0141

/** The levels of the pyramid of a view: 7 when its smaller side holds them, else fewer (the motion is not estimated). */
export const denoiseMips = (size: readonly [number, number]) =>
  Math.min(DN_MIPS, 1 + Math.floor(Math.log2(Math.min(size[0], size[1]))))

/** The error distance of a CIE 2000 difference. */
export const errorDistanceOfDeltaE = (deltaE: number) => Math.log2(2 + deltaE * DN_DELTA_E_SCALE)

/** The blending factors of the temporal stage: Eta at -1 is one just-noticeable difference, Kappa at -1 makes the weight reach zero at `DeltaE`. */
export function blendingFactors(settings: PathTracingSettings) {
  const eta =
    settings.pathTracingTemporalDenoiserEta === -1
      ? errorDistanceOfDeltaE(1)
      : settings.pathTracingTemporalDenoiserEta
  let kappa = settings.pathTracingTemporalDenoiserKappa
  if (kappa === -1) {
    const deltaE = Math.max(settings.pathTracingTemporalDenoiserDeltaE, 1 + 1e-6)
    kappa = 1 / (errorDistanceOfDeltaE(deltaE) - eta)
  }
  return { kappa, eta, alpha: settings.pathTracingTemporalDenoiserAlpha }
}

/** The passes of blur a level of the pyramid takes (each a horizontal and a vertical one). */
export const blurSize = (mip: number) => (mip === 0 ? 3 : mip === 2 ? 2 : 1)

/** Whether the level estimates the motion of the image against itself, to subtract it. */
export const removesSelfOffset = (settings: PathTracingSettings, mip: number) =>
  settings.pathTracingTemporalDenoiserMotionOperation === 1 &&
  mip <= settings.pathTracingTemporalDenoiserSubPixelOffsetStartMip &&
  settings.pathTracingTemporalDenoiserSubPixelOffset

/** Whether the level fits a sub-pixel offset. */
export const usesSubPixel = (settings: PathTracingSettings, mip: number) =>
  mip <= settings.pathTracingTemporalDenoiserSubPixelOffsetStartMip &&
  settings.pathTracingTemporalDenoiserSubPixelOffset

/** Whether the level measures the total variation of the error. */
export const usesTotalVariation = (settings: PathTracingSettings, mip: number) =>
  settings.pathTracingTemporalDenoiserTotalVariation &&
  mip === 0 &&
  settings.pathTracingTemporalDenoiserSubPixelOffset

/** The motion source that asks for the fusion of variances rather than a texture. */
export const sourceIsFusion = (source: number) => source < 0 || source > 3

/** Whether the prepass keeps a variance map: the fusion needs it, and so does the image of the variance, written on demand (the spatial stage reads it). */
export const wantsVarianceTexture = (settings: PathTracingSettings) =>
  settings.pathTracingDenoiserOutputVarianceTexture || settings.pathTracingSpatialDenoiser
export const wantsVarianceMap = (settings: PathTracingSettings) =>
  sourceIsFusion(settings.pathTracingTemporalDenoiserSource) || wantsVarianceTexture(settings)
/** Whether the radiance of the last image must be kept: the motion sources that read it, the albedo or the normals of it. */
export const keepsFeatureHistory = (settings: PathTracingSettings) =>
  settings.pathTracingTemporalDenoiser &&
  [1, 2, 3].includes(settings.pathTracingTemporalDenoiserSource)
