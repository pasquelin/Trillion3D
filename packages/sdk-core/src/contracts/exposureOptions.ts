import { isFiniteNumber } from '../../../math/src/scalar/reals.ts'
import { SRGB_LUMINANCE } from '../../../math/src/color/color.ts'
import {
  ANY_NUMBER as ANY,
  atLeast,
  choiceSetting as choice,
  flagSetting as flag,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'
import { refusal } from './nameMatch.ts'

/**
 * The exposure of a view: how bright the image is made before its display curve, by a number you
 * choose, or by the scene itself, and how its contrast is spread over it (`localExposure…`).
 * Run-time settings, as `./settingRules.ts` says.
 *
 * `'auto'` measures the image each frame on the GPU — by default a histogram of the log of its
 * luminance —, takes the mean between two percentiles of it, and brings that mean to middle grey
 * times two to the `exposureBias`: a view lit by the sun and a view in shade both land on the same
 * average brightness, whatever the lamps' power. The exposure follows the target at a speed (up
 * when the view brightens, down when it darkens) on the world's time, and a view cut jumps to it.
 * `exposureMethod` picks how the image is measured, or `'manual'`: no measure, the exposure comes
 * from the camera's settings (`exposureManual.ts`). A number is a fixed exposure: radiance is
 * multiplied by it as it is, the bias, the curve and the camera ignored — the manual exposure that
 * a camera of EV100 `-log2(number · saturation luminance)` gives. A view lit by no declared lamp
 * has no radiance to expose: it keeps an exposure of 1, whatever it asks.
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
  if (!isFiniteNumber(option) || option <= 0)
    return refusal('exposure')(
      `must be 'auto' or a finite number above zero, true or false, got ${String(option)}`,
    )
  return option
}

/** The buckets of the histogram the automatic exposure measures: a power of two, 64 in the
 *  reference. Not a setting: the measure's shader is built on it. */
export const EXPOSURE_HISTOGRAM_BUCKETS = 64
/** The middle grey the measured mean is brought to, before the bias: 18 % reflectance. The one
 *  constant every pass reads: the meter, the curve's read, the local exposure, the film's pivot. */
export const EXPOSURE_MIDDLE_GREY = 0.18
/** The sensor's saturation-speed constant of the ISO speed standard (12232:2006), over the lens
 *  attenuation `exposureLensAttenuation`: the luminance that saturates the sensor at EV100 0. */
const EXPOSURE_SATURATION_SPEED = 0.78

/** How the exposure is found: `histogram` the mean between two percentiles of the image's
 *  histogram of log luminance, `basic` the weighted mean of its log luminance, a cheaper measure,
 *  `manual` none — the exposure follows the camera's settings (`exposureManual.ts`). */
const EXPOSURE_METHODS = ['histogram', 'basic', 'manual'] as const

/** The luminance that saturates the sensor at EV100 0, for a lens attenuation `lens` (at least
 *  0.01, `exposureLensAttenuation`): 1 at the default, where lighting is unitless. Every EV100 of
 *  the exposure — its range, its histogram, its curve, the camera's — is read from it:
 *  `luminance = saturation · 2^EV100`. */
export const exposureSaturationLuminance = (lens: number) => EXPOSURE_SATURATION_SPEED / lens

/** The number the lighting kept from one image to the next is written multiplied by, for a
 *  `cachedLightingPreExposure` of `stops`: 2 to the minus `stops`. Its inverse is what the light
 *  that reads it is multiplied by. */
export const cachedPreExposure = (stops: number) => 2 ** -stops

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
 *   (`EXPOSURE_LUMINANCE_WEIGHTS`);
 * - `preExposure` (true): every light the image holds is written already multiplied by the
 *   exposure of the image before (times the scene colour tint's luminance), and the composition
 *   multiplies it by the exposure over that number: the image keeps the range of the half floats
 *   it is stored in at any exposure, and what is kept from one image to the next (the temporal
 *   pass, the fog volume, the clouds, the reflections' image) is brought to the new number by
 *   the ratio of the two. The picture is the same either way; false writes every light as it is
 *   (a pre-exposure of 1), the pre-exposure being off for a view that is not lit or that shows
 *   raw values;
 * - `preExposureOverride` (0): above 0, the pre-exposure every light is multiplied by, in place
 *   of the exposure of the image before; 0 keeps that exposure;
 * - `cachedLightingPreExposure` (4), from −16 to 16 stops: the pre-exposure of the lighting that is
 *   kept from one image to the next whatever the exposure of each — the sky light's real-time
 *   capture —, 2 to the minus that number (`cachedPreExposure`): it is written multiplied by it
 *   and read multiplied by its inverse, so the half floats it is stored in neither clip nor
 *   lose their precision across an exposure range: 4 covers about −8 to +12 stops of exposure,
 *   8 about −4 to +16. The one number for every image, read whether `preExposure` is on or off;
 * - `exposureMethod` (`'histogram'`): how the exposure is found (`EXPOSURE_METHODS`); `'basic'`
 *   takes the mean of the image's log luminance over a coarse grid of it — the image's quarter-size
 *   texels' log luminance, brought down by four levels of 4 × 4 means —, each texel weighted by
 *   the metering mask where there is one (`exposureMeterMask.ts`), and `'manual'` measures
 *   nothing: the exposure is the camera's (`exposureManual.ts`, read by the next four fields);
 * - `exposureApplyPhysicalCamera` (true): where the method is manual, whether the camera's
 *   aperture, shutter speed and ISO set the exposure (its EV100); false, the camera is EV100 0
 *   and the bias alone sets it. The aperture is the depth of field's (f/4 where the view has
 *   none);
 * - `exposureCameraShutterSpeed` (60, from 0.01 to 8000) and `exposureCameraIso` (100, from 1): the
 *   camera's shutter speed in 1/s and sensitivity: EV100 = log2(aperture² · shutter speed · 100 / ISO);
 * - `exposureLensAttenuation` (0.78, from 0.01): the camera lens' attenuation. 0.78 makes lighting
 *   unitless (a luminance of 1 is EV100 0); a lower one raises the saturation luminance the
 *   EV100s are read from (`exposureSaturationLuminance`).
 *
 * The local exposure brings each pixel's light nearer to middle grey by how far the light around
 * it is from it: the log of the luminance is split into a base layer, the smooth light of the
 * neighbourhood — a bilateral grid of the half-size image, which keeps the edges, blended with a
 * wide blur of it —, and a detail layer, what the pixel adds to it; the base is pulled toward
 * middle grey by a contrast scale, the detail kept by its strength. It runs on the lit image after
 * the exposure and before the curve, on by default: both contrasts are 0.8, a new project's (the
 * reference's engine default is 1, neutral, which a new project sets to 0.8). A contrast of 1 for
 * both layers with a detail strength of 1 would leave the image as it is, drawing none of it. Each
 * setting has the reference's default:
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
    flag('preExposure', true),
    nonNegative('preExposureOverride', 0),
    number('cachedLightingPreExposure', 4, [-16, 16]),
    choice('exposureMethod', 'histogram', EXPOSURE_METHODS),
    flag('exposureApplyPhysicalCamera', true),
    number('exposureCameraShutterSpeed', 60, [0.01, 8000]),
    number('exposureCameraIso', 100, atLeast(1)),
    number('exposureLensAttenuation', 0.78, atLeast(0.01)),
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
/** The automatic exposure's settings, resolved (`resolveSettings`). */
export type ExposureValues = SettingValues<typeof EXPOSURE_RULES>
/** The automatic exposure's settings as a host writes them, by their fields: each its value, or
 *  nothing for its default. */
export type ExposureOptions = SettingOptions<typeof EXPOSURE_RULES>
