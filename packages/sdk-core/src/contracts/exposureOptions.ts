import { SRGB_LUMINANCE } from '../../../math/src/color/color.ts'
import {
  ANY_NUMBER as ANY,
  choiceSetting as choice,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'
import { refusal } from './nameMatch.ts'

/**
 * The exposure of a view: how bright the image is made before its display curve, by a number you
 * choose, or by the scene itself, and how its contrast is spread over it (`localExposure…`).
 * Run-time settings, as `./settingRules.ts` says.
 *
 * `'auto'` measures the image each frame on the GPU — a histogram of the log of its luminance —,
 * takes the mean between two percentiles of it, and brings that mean to middle grey times two to
 * the `exposureBias`: a view lit by the sun and a view in shade both land on the same average
 * brightness, whatever the lamps' power. The exposure follows the target at a speed (up when the
 * view brightens, down when it darkens), and a view cut jumps to it. A number is the manual
 * exposure: radiance is multiplied by it as it is. A view lit by no declared lamp has no radiance to
 * expose: it keeps an exposure of 1, whatever it asks.
 */

/** What the exposure option names: a number above zero, `'auto'`. */
export type SceneExposure = number | 'auto'
/** What a host writes for the exposure: a number above zero, `'auto'`, `true` (the default, the
 *  automatic one) or `false` (none: exposure 1). */
export type ExposureOption = SceneExposure | boolean

/** The exposure of a view that names none, the reference's own default: the automatic one. */
export const DEFAULT_EXPOSURE: SceneExposure = 'auto'
/** The exposure that leaves radiance as it is. */
export const UNIT_EXPOSURE = 1

/**
 * The exposure an option names: `undefined` or `null` the default, as `true`; `false` none (1); a
 * number above zero, or `'auto'`, as itself. The one reading of the option, whoever takes it — the
 * world, an environment, a session.
 * @throws TypeError naming what it takes when it is none of them.
 */
export function resolveExposure(option?: ExposureOption | null): SceneExposure {
  if (option === undefined || option === null || option === true) return DEFAULT_EXPOSURE
  if (option === false) return UNIT_EXPOSURE
  if (option === 'auto') return option
  if (typeof option !== 'number' || !Number.isFinite(option) || option <= 0)
    return refusal('exposure')(
      `must be 'auto' or a finite number above zero, true or false, got ${String(option)}`,
    )
  return option
}

/** The buckets of the histogram the automatic exposure measures: a power of two, 64 in the
 *  reference. Not a setting: the measure's shader is built on it. */
export const EXPOSURE_HISTOGRAM_BUCKETS = 64
/** The middle grey the measured mean is brought to, before the bias: 18 % reflectance. */
export const EXPOSURE_MIDDLE_GREY = 0.18

/** How the luminance of a pixel is read from its colour, the reference's three ways: `uniform`
 *  the mean of the three channels, `ntsc` the legacy video weights, `workingSpace` the weights of
 *  the sRGB primaries (`luminance`, `packages/math/src/wgsl/color.ts`). */
export const EXPOSURE_LUMINANCE_WEIGHTS = /* @__PURE__ */ (() =>
  ({
    uniform: [1 / 3, 1 / 3, 1 / 3],
    ntsc: [0.3, 0.59, 0.11],
    workingSpace: SRGB_LUMINANCE,
  }) as const)()
const EXPOSURE_LUMINANCE_METHODS = ['uniform', 'ntsc', 'workingSpace'] as const

/**
 * The settings of the exposure by field, each with the reference's default:
 * - `exposureBias` (+1): stops added to the target, the mean landing at 0.18 · 2^bias before the
 *   display curve;
 * - `exposureMinBrightness` (−10) and `exposureMaxBrightness` (+20): the range of the mean the
 *   exposure follows, in EV100 — one stop is a doubling of luminance, EV100 0 a luminance of 1 —;
 *   the same value for both fixes the exposure;
 * - `exposureHistogramLogMin` (−10) and `exposureHistogramLogMax` (+20): the stops of luminance the
 *   histogram spans (read no higher than one stop under the high end); a pixel outside lands in
 *   the end bucket;
 * - `exposureLowPercent` (10) and `exposureHighPercent` (90), from 1 to 99 (the low one read no
 *   higher than the high one): the share of the pixels, darkest first, under and over which the
 *   mean is not taken;
 * - `exposureSpeedUp` (3) and `exposureSpeedDown` (1): stops a second the exposure moves when the
 *   target is farther than `exposureTransitionDistance` (1.5 stops), past which it slows
 *   exponentially into it; a speed of 0 holds, a camera cut jumps;
 * - `exposureBlackBucketWeight` (0), from 0 to 1: how much the darkest bucket counts, the pixels
 *   of no light, in the histogram: 0 ignores them, 1 counts them as any;
 * - `exposureLuminanceMethod` (`'uniform'`): how a pixel's luminance is read
 *   (`EXPOSURE_LUMINANCE_WEIGHTS`).
 *
 * The local exposure brings each pixel's light nearer to middle grey by how far the light around
 * it is from it: the log of the luminance is split into a base layer, the smooth light of the
 * neighbourhood — a bilateral grid of the half-size image, which keeps the edges, blended with a
 * wide blur of it —, and a detail layer, what the pixel adds to it; the base is pulled toward
 * middle grey by a contrast scale, the detail kept by its strength. It runs on the lit image after
 * the exposure and before the curve, and a contrast of 1 for both layers with a detail strength of
 * 1 leaves the image as it is, drawing none of it. Each setting has the reference's default but
 * the two contrasts, which are 0.8 as a new project writes them:
 * - `localExposureHighlightContrast` (0.8) and `localExposureShadowContrast` (0.8): the scale of
 *   the base layer above and under middle grey; under 1 the highlights come down and the shadows
 *   come up;
 * - `localExposureDetailStrength` (1): the scale of the detail layer;
 * - `localExposureBlurBlend` (0.6), from 0 to 1: how much of the base is the wide blur, the rest
 *   the bilateral grid, which follows edges but rings at them;
 * - `localExposureBlurSize` (50): the width of that blur, in percent of the image, read at 1/32 of
 *   its size;
 * - `localExposureMiddleGreyBias` (0): stops added to the middle grey the base is pulled toward
 *   (an automatic exposure's own bias already moves it);
 * - `localExposureHighlightThreshold` (0) and `localExposureShadowThreshold` (0): the distance in
 *   stops from middle grey the base keeps its own contrast within, above and under it;
 * - `localExposureHighlightThresholdStrength` (1) and `localExposureShadowThresholdStrength` (1),
 *   from 0 to 1: how sharply the contrast scale takes over past the thresholds, 1 the sharpest.
 */
export const EXPOSURE_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    number('exposureBias', 1, ANY),
    number('exposureMinBrightness', -10, ANY),
    number('exposureMaxBrightness', 20, ANY),
    number('exposureHistogramLogMin', -10, ANY),
    number('exposureHistogramLogMax', 20, ANY),
    number('exposureLowPercent', 10, [1, 99]),
    number('exposureHighPercent', 90, [1, 99]),
    nonNegative('exposureSpeedUp', 3),
    nonNegative('exposureSpeedDown', 1),
    nonNegative('exposureTransitionDistance', 1.5),
    number('exposureBlackBucketWeight', 0, [0, 1]),
    choice('exposureLuminanceMethod', 'uniform', EXPOSURE_LUMINANCE_METHODS),
    nonNegative('localExposureHighlightContrast', 0.8),
    nonNegative('localExposureShadowContrast', 0.8),
    nonNegative('localExposureDetailStrength', 1),
    number('localExposureBlurBlend', 0.6, [0, 1]),
    nonNegative('localExposureBlurSize', 50),
    number('localExposureMiddleGreyBias', 0, ANY),
    nonNegative('localExposureHighlightThreshold', 0),
    nonNegative('localExposureShadowThreshold', 0),
    number('localExposureHighlightThresholdStrength', 1, [0, 1]),
    number('localExposureShadowThresholdStrength', 1, [0, 1]),
  ] as const))()
/** The field of one setting of the automatic exposure. */
export type ExposureField = keyof typeof EXPOSURE_RULES
/** The automatic exposure's settings as a host writes them, by their fields: each its value, or
 *  nothing for its default. */
export type ExposureOptions = SettingOptions<typeof EXPOSURE_RULES>
