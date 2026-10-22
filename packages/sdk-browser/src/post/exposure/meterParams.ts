import {
  EXPOSURE_LUMINANCE_WEIGHTS,
  EXPOSURE_MIDDLE_GREY,
  type EXPOSURE_RULES,
} from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import type { SettingValues } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { halfOf } from '../filters/levelSizes.ts'
import { METER_PARAMS } from './meterLayout.ts'

/** The automatic exposure's settings, resolved (`resolveSettingsInto`). */
export type ExposureSettings = SettingValues<typeof EXPOSURE_RULES>

/** Seconds of the frame the exponential's multiplier is matched to the linear run at: the
 *  multiplier makes both move as fast where they meet. */
const MATCHED_FRAME = 1 / 60

const AT = METER_PARAMS.at

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
 * its highest. The meter (`writeMeterParams`) and the local exposure, which reads the same
 * luminance, take them from here; the object is the same at each call, read before the next.
 */
export function luminanceReading(settings: ExposureSettings) {
  const logMax = settings.exposureHistogramLogMax
  const logMin = Math.min(settings.exposureHistogramLogMin, logMax - 1)
  reading.weights = EXPOSURE_LUMINANCE_WEIGHTS[settings.exposureLuminanceMethod]
  reading.lowest = 2 ** logMin
  reading.scale = 1 / (logMax - logMin)
  reading.bias = -logMin * reading.scale
  return reading
}

/**
 * Writes the meter's uniform (`METER_PARAMS`) into `words`, `ints` its view as unsigned words: the
 * `size` pixels measured, the settings' derived terms, `seconds` since the last update, and
 * whether the exposure `jumps` to what the mean asks — a first update, a view cut, or a range
 * that is no range. The mean's range is held in luminance (`2^EV100`, the luminance of EV100 0
 * being 1), the histogram's logarithms in stops, the lowest at least one under the highest.
 */
export function writeMeterParams(
  words: Float32Array,
  ints: Uint32Array,
  settings: ExposureSettings,
  size: readonly number[],
  seconds: number,
  jumps: boolean,
) {
  const reading = luminanceReading(settings)
  const high = settings.exposureHighPercent / 100
  const low = Math.min(settings.exposureLowPercent / 100, high)
  const lowest = 2 ** Math.min(settings.exposureMinBrightness, settings.exposureMaxBrightness)
  const highest = 2 ** settings.exposureMaxBrightness
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
}
