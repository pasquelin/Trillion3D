import { clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { fieldsOf, refusal } from '../../contracts/nameMatch.ts'
import {
  ANY_NUMBER as ANY,
  atLeast,
  choiceSetting as choice,
  flagSetting as flag,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  resolveSettings,
  rulesOf,
  type SettingValues,
  vectorSetting as vector,
} from '../../contracts/settingRules.ts'
import { CLOUD_MATERIAL_RULES, type CloudMaterial } from './cloudMaterial.ts'
import { CM_PER_KM, type SkyQualityValues } from './quality.ts'

/**
 * The clouds part of the sky module: one layer of clouds, a shell round the planet ray marched
 * from the eye, drawn with the cloud material (`./cloudMaterial.ts`). Run-time settings, as
 * `../../contracts/settingRules.ts` says; each has the layer's default. Distances are in
 * kilometres, as written.
 */

/** The tracing distance modes, in the order the marcher is told them. */
const TRACING_MODES = ['layerEntry', 'eye'] as const

/**
 * The settings of the layer by field:
 * - `baseAltitudeKm` (5) above the ground and `thicknessKm` (10, at least 0.1): the shell;
 * - `farthestEntryKm` (350, at least 1): a ray whose layer entry is farther is not
 *   traced; `nearestStartKm` (0): the nearest it starts;
 * - `marchLengthFrom` (`'layerEntry'`) and `marchLengthKm` (50, at least 0.1):
 *   the longest path traced, from where the ray enters the layer or from the eye;
 * - `planetRadiusKm` (6360, 0.1 to 10000): the planet's, read only where no atmosphere gives one;
 * - `groundAlbedo` (0.4019778 linear grey): the ground's light the clouds bounce;
 * - `sunTintPerSample` (false): the sun's colour at each sample, not once
 *   per ray;
 * - `undersideSkyLoss` (0.5, 0 to 1): how much sky light the cloud's underside loses, where the
 *   material gives no occlusion of its own; the built-in material always gives one
 *   (`ambientOcclusion`), so no cloud of it reads the setting;
 * - `viewSamplesScale` (1), `reflectionSamplesScale` (1), `shadowSamplesScale` (1),
 *   `reflectionShadowSamplesScale` (1), each at least 0.05: the samples of a ray, of one in a
 *   reflection, of a shadow ray, of one in a reflection (at a scale of 1: 96, at most the quality's
 *   80, and 10, at most 24);
 * - `shadowRayLengthKm` (15, at least 0.01): how far a shadow ray goes;
 * - `opaqueBelow` (0.005, 0 to 1): a ray that lets less light through ends;
 * - `hazeRayleighStartKm`, `…RayleighFadeKm`, `…MieStartKm`, `…MieFadeKm` (0):
 *   where the air's two scatterings start to tint the cloud and over how far they come in;
 * - `nearestStartKm` is also the distance under which a pixel takes no cloud; the distances of the
 *   reprojection and the disocclusion, and the late fog, are quality settings (`./quality.ts`);
 * - `alphaHole` (false): the clouds hold their light out, drawing black and laying their coverage on the image's alpha, where the alpha holdout is in effect (`../../contracts/filmOptions.ts`); `inMainView` (true), `inSkyCapture` (true).
 */
export const CLOUD_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    number('baseAltitudeKm', 5, ANY),
    number('thicknessKm', 10, atLeast(0.1)),
    number('farthestEntryKm', 350, atLeast(1)),
    nonNegative('nearestStartKm', 0),
    choice('marchLengthFrom', 'layerEntry', TRACING_MODES),
    number('marchLengthKm', 50, atLeast(0.1)),
    number('planetRadiusKm', 6360, [0.1, 10000]),
    vector('groundAlbedo', [0.4019778, 0.4019778, 0.4019778]),
    flag('sunTintPerSample', false),
    number('undersideSkyLoss', 0.5, [0, 1]),
    number('viewSamplesScale', 1, atLeast(0.05)),
    number('reflectionSamplesScale', 1, atLeast(0.05)),
    number('shadowSamplesScale', 1, atLeast(0.05)),
    number('reflectionShadowSamplesScale', 1, atLeast(0.05)),
    number('shadowRayLengthKm', 15, atLeast(0.01)),
    number('opaqueBelow', 0.005, [0, 1]),
    nonNegative('hazeRayleighStartKm', 0),
    nonNegative('hazeRayleighFadeKm', 0),
    nonNegative('hazeMieStartKm', 0),
    nonNegative('hazeMieFadeKm', 0),
    flag('alphaHole', false),
    flag('inMainView', true),
    flag('inSkyCapture', true),
  ] as const))()

/** The samples of a view ray and of a shadow ray at a scale of 1. */
const VIEW_SAMPLES = 96
const SHADOW_SAMPLES = 10
/** The fewest samples a ray takes, whatever its scale and the quality's maximum. */
const LEAST_SAMPLES = 2
/** The floor under a fade distance before it is inverted, in kilometres. */
const FADE_FLOOR_KM = 0.00001
/** The shortest shadow distance the marcher is given, in kilometres. */
const LEAST_SHADOW_DISTANCE_KM = 0.1

const samples = (scale: number, base: number, most: number) =>
  clampLowWins(base * scale, LEAST_SAMPLES, most)

/** The part as the marcher reads it: the settings, and what it is told of them. */
export interface CloudPart {
  readonly settings: SettingValues<typeof CLOUD_RULES>
  readonly material: CloudMaterial
  /** The quality settings the marcher is built with (`./quality.ts`). */
  readonly quality: SkyQualityValues
  readonly gpu: ReturnType<typeof gpuValues>
}

/** The settings as the marcher is given them, in the order it reads them: distances in
 *  centimetres, sample counts, the sky light's bottom visibility, the air's fades inverted; and the
 *  quality's sample rules as the marcher reads them: the fewest and the clamped count, the inverse
 *  of the distance over which the count grows, the step over empty air. */
function gpuValues(layer: SettingValues<typeof CLOUD_RULES>, quality: SkyQualityValues) {
  return {
    undersideSkyKept: 1 - layer.undersideSkyLoss,
    farthestEntryCm: Math.max(0, CM_PER_KM * layer.farthestEntryKm),
    nearestStartCm: Math.max(0, CM_PER_KM * layer.nearestStartKm),
    nearestStartKm: Math.max(0, layer.nearestStartKm),
    marchLengthCm: Math.max(0, CM_PER_KM * layer.marchLengthKm),
    marchLengthFrom: TRACING_MODES.indexOf(layer.marchLengthFrom),
    viewSamplesMost: samples(layer.viewSamplesScale, VIEW_SAMPLES, quality.cloudViewSamplesMax),
    shadowSamplesMost: samples(
      layer.shadowSamplesScale,
      SHADOW_SAMPLES,
      quality.cloudShadowSamplesMax,
    ),
    shadowRayLengthCm: CM_PER_KM * Math.max(LEAST_SHADOW_DISTANCE_KM, layer.shadowRayLengthKm),
    reflectionSamplesMost: samples(
      layer.reflectionSamplesScale,
      VIEW_SAMPLES,
      quality.cloudReflectionSamplesMax,
    ),
    reflectionShadowSamplesMost: samples(
      layer.reflectionShadowSamplesScale,
      SHADOW_SAMPLES,
      quality.cloudReflectionShadowSamplesMax,
    ),
    samplesMin: Math.max(0, quality.cloudSamplesMin),
    samplesClamp: Math.max(0, quality.cloudSamplesClamp),
    samplesDistanceInverse: 1 / Math.max(1, CM_PER_KM * quality.cloudDistanceToMaxSamplesKm),
    stepOnEmpty: Math.max(quality.cloudStepOnEmpty, 1),
    hazeRayleighFadeInverse: 1 / Math.max(layer.hazeRayleighFadeKm, FADE_FLOOR_KM),
    hazeMieFadeInverse: 1 / Math.max(layer.hazeMieFadeKm, FADE_FLOOR_KM),
  }
}

/** Whether the clouds ask the air for its Mie scattering and its Rayleigh scattering apart: either
 *  one starts on the cloud past 0 kilometres. */
export const cloudSeparatesAir = (layer: SettingValues<typeof CLOUD_RULES>) =>
  layer.hazeRayleighStartKm > 0 || layer.hazeMieStartKm > 0

/**
 * The one reading of the part's merged fields: the layer's and the material's settings, each its
 * default when the fields hold none, and what the marcher is told of them with the sky's `quality`
 * settings (`./quality.ts`).
 * @throws TypeError naming a field the part does not have, or a value a field does not take.
 */
export function resolveCloudPart(
  fields: Readonly<Record<string, unknown>>,
  quality: SkyQualityValues,
): CloudPart {
  const names = [...Object.keys(CLOUD_RULES), ...Object.keys(CLOUD_MATERIAL_RULES)]
  const held = fieldsOf(fields, names, 'the clouds part', refusal('clouds'))
  const settings = resolveSettings(CLOUD_RULES, held)
  return {
    settings,
    material: resolveSettings(CLOUD_MATERIAL_RULES, held),
    quality,
    gpu: gpuValues(settings, quality),
  }
}

/** The part under other quality settings: the same layer and material, the marcher's values worked
 *  out again from `quality` (what the frame does where a quality setting moves). */
export const cloudPartAt = (part: CloudPart, quality: SkyQualityValues): CloudPart => ({
  ...part,
  quality,
  gpu: gpuValues(part.settings, quality),
})
