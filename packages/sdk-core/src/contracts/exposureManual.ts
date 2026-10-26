import {
  EXPOSURE_MIDDLE_GREY,
  exposureSaturationLuminance,
  type ExposureValues,
} from './exposureOptions.ts'
import { exposureCurveFactor } from './exposureCurveTable.ts'

/**
 * THE EXPOSURES THE ENGINE HOLDS WITHOUT MEASURING, a fixed number and the manual method: the
 * values the meter's exposure buffer is written with each image, so that a switch back to a
 * measuring method starts from the exposure shown.
 *
 * The manual exposure comes from the camera and the bias.
 * The camera's EV100 is `log2(aperture² · shutter speed · 100 / ISO)` (`exposureApplyPhysicalCamera`
 * true) or 0 (false); the white point, the luminance that comes out as white, is the saturation
 * luminance times two to the EV100 (`exposureSaturationLuminance`); and the exposure is two to the
 * `exposureBias` times the compensation curve's factor, over the white point. The curve is read
 * where an image of that very white point would put it — a mean luminance of the white point,
 * or of 1 where the low and the high percentile are the same (`exposureLowPercent`,
 * `exposureHighPercent`), as the histogram's mean gives for an image with no pixel.
 *
 * With the physical camera off, a camera of EV100 0 and a lens attenuation of 0.78 (a saturation
 * luminance of 1), the exposure is two to the bias: a number `n` is the bias `log2(n)`.
 *
 * A fixed exposure, a number `n`, is `n` itself: the bias, the curve and the camera are ignored.
 */

/** The least white point a manual exposure divides by: the exposure never exceeds 10 000 over
 *  its compensation. */
const LEAST_WHITE = 1e-4

/** The EV100 of a camera of `aperture` (its f-stop) and the settings' shutter speed and ISO:
 *  `log2(aperture² · shutter speed · 100 / ISO)`, the ISO read at least 1. */
const cameraEv100 = (settings: ExposureValues, aperture: number) =>
  Math.log2(
    (aperture * aperture * settings.exposureCameraShutterSpeed * 100) /
      Math.max(1, settings.exposureCameraIso),
  )

/**
 * What an exposure the engine holds is, the words of the meter's exposure buffer: `exposure` the
 * scale the image is multiplied by; `mean` the mean luminance an image with that white point would
 * have (what the curve was read at); `compensation` the multiplier the middle grey is brought to
 * (the bias and the curve's factor in it); `grey` the log2 of the middle grey the local exposure
 * pulls toward. A manual exposure cancels the bias out of the grey and keeps the curve's factor.
 */
export interface HeldExposure {
  exposure: number
  mean: number
  compensation: number
  grey: number
}

/** A new held exposure, an exposure of 1. */
export const newHeldExposure = (): HeldExposure => ({
  exposure: 1,
  mean: 1,
  compensation: 1,
  grey: Math.log2(EXPOSURE_MIDDLE_GREY),
})

/** The mean luminance the manual exposure's curve is read at: the white point, 1 where the
 *  low percentile, read no higher than the high one, is the same as it (to a hundredth of a
 *  percent). */
const curveMean = (
  { exposureLowPercent: low, exposureHighPercent: high }: ExposureValues,
  white: number,
) => (high - Math.min(low, high) < 0.01 ? 1 : white)

/** The log2 of the middle grey the local exposure pulls toward, with the compensation `factor` the
 *  grey keeps (the curve's, or 1) and the local bias. */
const greyOf = (settings: ExposureValues, factor: number) =>
  Math.log2(EXPOSURE_MIDDLE_GREY * factor * 2 ** settings.localExposureMiddleGreyBias)

/**
 * The manual exposure of `settings` for a camera of f-stop `aperture`, the compensation curve baked
 * in `table` (`exposureCurveTable`). Written into `out` when given, else a new object.
 */
export function manualExposure(
  settings: ExposureValues,
  table: ArrayLike<number>,
  aperture: number,
  out: HeldExposure = newHeldExposure(),
): HeldExposure {
  const ev100 = settings.exposureApplyPhysicalCamera ? cameraEv100(settings, aperture) : 0
  const saturation = exposureSaturationLuminance(settings.exposureLensAttenuation)
  const white = saturation * 2 ** ev100
  out.mean = curveMean(settings, white)
  const curve = exposureCurveFactor(table, Math.log2(out.mean / EXPOSURE_MIDDLE_GREY / saturation))
  out.compensation = 2 ** settings.exposureBias * curve
  out.exposure = out.compensation / Math.max(LEAST_WHITE, white)
  out.grey = greyOf(settings, curve)
  return out
}

/** The fixed exposure `exposure`, a number the scene names. Written into `out` when given. */
export function fixedExposure(
  exposure: number,
  settings: ExposureValues,
  out: HeldExposure = newHeldExposure(),
): HeldExposure {
  out.exposure = exposure
  out.mean = 1 / exposure
  out.compensation = 1
  out.grey = greyOf(settings, 1)
  return out
}
