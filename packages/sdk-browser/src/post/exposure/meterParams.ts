import {
  EXPOSURE_LUMINANCE_WEIGHTS,
  EXPOSURE_MIDDLE_GREY,
  exposureSaturationLuminance,
  type ExposureValues,
} from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { putVec4 } from '../../gpu/core/fieldLayout.ts'
import { halfOf } from '../filters/levelSizes.ts'
import { METER_PARAMS } from './meterLayout.ts'

/** Seconds of the frame the exponential's multiplier is matched to the linear run at: the
 *  multiplier makes both move as fast where they meet. */
const MATCHED_FRAME = 1 / 60

const AT = METER_PARAMS.at
/** How near to 1 a contrast or a strength is to leave the image as it is. */
const NEARLY = 1e-8
/** The distance past a threshold, in stops, of a strength of 1: the contrast scale takes over
 *  at once, as a distance no image reaches. */
const SHARPEST = 1e30

const moved = (value: number) => Math.abs(value - 1) > NEARLY

/** Whether the settings ask the local exposure to run: a contrast, or the detail, not 1, or a contrast curve
 *  (`curved`: a curve set, whatever it gives). At 1 for all three and with no curve the layers put every pixel back where it was. */
export const localExposureOn = (settings: ExposureValues, curved = false) =>
  curved ||
  moved(settings.localExposureHighlightContrast) ||
  moved(settings.localExposureShadowContrast) ||
  moved(settings.localExposureDetailStrength)

/** How far past a threshold the contrast takes over: `1 / (1 − strength)` stops. */
export const reachOf = (strength: number) => (strength >= 1 ? SHARPEST : 1 / (1 - strength))

/**
 * The multiplier that makes the exponential approach move as fast, where the linear run gives way
 * to it at `distance` stops, as the linear run at `speed` stops a second: at that distance both
 * cover `speed · dt` in a frame of `MATCHED_FRAME`. A speed of 0 holds the exposure: its multiplier
 * is 0, where the quotient would divide by zero.
 */
function exponentialMultiplier(speed: number, distance: number) {
  if (speed <= 0) return 0
  const startTime = distance / Math.max(speed, 0.001)
  return MATCHED_FRAME / ((1 - 2 ** (-MATCHED_FRAME * speed)) * startTime)
}

/** What `luminanceReading` gives, rewritten at each call: a frame allocates none. */
const reading = {
  weights: EXPOSURE_LUMINANCE_WEIGHTS.uniform as readonly number[],
  lowest: 0,
  scale: 0,
  bias: 0,
}

/**
 * How the exposure reads a pixel's luminance and places it in its histogram, from the settings:
 * the weights of the colour channels, the lowest luminance counted, and the scale and bias taking
 * a log2 luminance into [0, 1] over the histogram, whose lowest stop is read at least one under
 * its highest. The histogram's stops are EV100s: they are moved by the saturation luminance's
 * logarithm (`exposureSaturationLuminance`). The meter (`writeMeterParams`) and the local
 * exposure, which reads the same luminance, take them from here; the object is the same at each
 * call, read before the next.
 */
export function luminanceReading(settings: ExposureValues) {
  const shift = Math.log2(exposureSaturationLuminance(settings.exposureLensAttenuation))
  const logMax = settings.exposureHistogramLogMax + shift
  const logMin = Math.min(settings.exposureHistogramLogMin + shift, logMax - 1)
  reading.weights = EXPOSURE_LUMINANCE_WEIGHTS[settings.exposureLuminanceMethod]
  reading.lowest = 2 ** logMin
  reading.scale = 1 / (logMax - logMin)
  reading.bias = -logMin * reading.scale
  return reading
}

/** What the meter's uniform is written from, for one image: the settings, the `size` of the image
 *  measured in pixels, `seconds` of the world's time since the last update, whether the exposure
 *  `jumps` to what the mean asks — a first update or a view cut —, the `preExposure` the image holds
 *  its light multiplied by, which the measure divides out, and whether a metering mask weighs the
 *  pixels (`masked`). */
export type MeterUniform = {
  settings: ExposureValues
  size: readonly number[]
  seconds: number
  jumps: boolean
  preExposure: number
  masked: boolean
  /** Whether a local exposure contrast curve is set (`localExposureOn`); none by default. */
  curved?: boolean
}

/**
 * Writes the meter's uniform (`METER_PARAMS`) into `words`, `ints` its view as unsigned words,
 * from `uniform`: the pixels measured, the settings' derived terms, the seconds since the last
 * update, and the jump — also taken where the range is no range. The mean's range is held in
 * luminance (the saturation luminance times `2^EV100`), the histogram's logarithms in stops, the
 * lowest at least one under the highest.
 */
export function writeMeterParams(words: Float32Array, ints: Uint32Array, uniform: MeterUniform) {
  const { settings, size, seconds, jumps, preExposure, masked, curved } = uniform
  const reading = luminanceReading(settings)
  const saturation = exposureSaturationLuminance(settings.exposureLensAttenuation)
  const high = settings.exposureHighPercent / 100
  const low = Math.min(settings.exposureLowPercent / 100, high)
  const lowest =
    saturation * 2 ** Math.min(settings.exposureMinBrightness, settings.exposureMaxBrightness)
  const highest = saturation * 2 ** settings.exposureMaxBrightness
  const validRange = settings.exposureMinBrightness < settings.exposureMaxBrightness
  const distance = settings.exposureTransitionDistance
  ints[AT.size] = size[0]
  ints[AT.size + 1] = size[1]
  ints[AT.size + 2] = halfOf(size[0])
  ints[AT.size + 3] = halfOf(size[1])
  words.set(reading.weights, AT.weights)
  words[AT.weights + 3] = reading.lowest
  words[AT.histogram] = reading.scale
  words[AT.histogram + 1] = reading.bias
  words[AT.histogram + 2] = settings.exposureBlackBucketWeight
  words[AT.bounds] = lowest * EXPOSURE_MIDDLE_GREY
  words[AT.bounds + 1] = highest * EXPOSURE_MIDDLE_GREY
  words[AT.bounds + 2] = low
  words[AT.bounds + 3] = high
  words[AT.speeds] = settings.exposureSpeedUp
  words[AT.speeds + 1] = settings.exposureSpeedDown
  words[AT.speeds + 2] = distance
  words[AT.speeds + 3] = seconds
  words[AT.response] = exponentialMultiplier(settings.exposureSpeedUp, distance)
  words[AT.response + 1] = exponentialMultiplier(settings.exposureSpeedDown, distance)
  words[AT.response + 2] = 2 ** settings.exposureBias
  words[AT.response + 3] = jumps || !validRange ? 1 : 0
  putVec4(
    words,
    AT.image,
    1 / preExposure,
    saturation,
    settings.exposureMethod === 'basic' ? 1 : 0,
    masked ? 1 : 0,
  )
  words[AT.local] = Math.log2(EXPOSURE_MIDDLE_GREY) + settings.localExposureMiddleGreyBias
  words[AT.local + 1] = settings.localExposureHighlightContrast
  words[AT.local + 2] = settings.localExposureShadowContrast
  words[AT.local + 3] = localExposureOn(settings, curved) ? 1 : 0
  words[AT.edges] = settings.localExposureHighlightThreshold
  words[AT.edges + 1] = settings.localExposureShadowThreshold
  words[AT.edges + 2] = reachOf(settings.localExposureHighlightThresholdStrength)
  words[AT.edges + 3] = reachOf(settings.localExposureShadowThresholdStrength)
}
