import { clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { fieldsOf, refusal } from '../../contracts/nameMatch.ts'
import {
  ANY_NUMBER as ANY,
  choiceSetting as choice,
  flagSetting as flag,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  resolveSettings,
  rulesOf,
  type SettingOptions,
  type SettingValues,
  vectorSetting as vector,
} from '../../contracts/settingRules.ts'
import { CLOUD_MATERIAL_RULES, type CloudMaterial } from './cloudMaterial.ts'

/**
 * The clouds part of the sky module: one layer of clouds, a shell round the planet ray marched
 * from the eye, drawn with the cloud material (`./cloudMaterial.ts`). Run-time settings, as
 * `../../contracts/settingRules.ts` says; each has the layer's default, but the two reflection
 * scales, which are those of a new world's sky. Distances are in kilometres, as written.
 */

/** From `low` up, a finite number. */
const from = (low: number): readonly [number, number] => [low, ANY[1]]
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
 * - `undersideSkyLoss` (0.5, 0 to 1): how much sky light the cloud's underside loses;
 * - `viewSamplesScale` (1), `reflectionSamplesScale` (0.1041667),
 *   `shadowSamplesScale` (1), `reflectionShadowSamplesScale` (0.3), each at least
 *   0.05: the samples of a ray, of one in a reflection, of a shadow ray, of one in a reflection;
 * - `shadowRayLengthKm` (15, at least 0.01): how far a shadow ray goes;
 * - `opaqueBelow` (0.005, 0 to 1): a ray that lets less light through ends;
 * - `hazeRayleighStartKm`, `…RayleighFadeKm`, `…MieStartKm`, `…MieFadeKm` (0):
 *   where the air's two scatterings start to tint the cloud and over how far they come in;
 * - `alphaHole` (false), `inMainView` (true), `inSkyCapture` (true).
 */
export const CLOUD_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    number('baseAltitudeKm', 5, ANY),
    number('thicknessKm', 10, from(0.1)),
    number('farthestEntryKm', 350, from(1)),
    nonNegative('nearestStartKm', 0),
    choice('marchLengthFrom', 'layerEntry', TRACING_MODES),
    number('marchLengthKm', 50, from(0.1)),
    number('planetRadiusKm', 6360, [0.1, 10000]),
    vector('groundAlbedo', [0.4019778, 0.4019778, 0.4019778]),
    flag('sunTintPerSample', false),
    number('undersideSkyLoss', 0.5, [0, 1]),
    number('viewSamplesScale', 1, from(0.05)),
    number('reflectionSamplesScale', 0.1041667, from(0.05)),
    number('shadowSamplesScale', 1, from(0.05)),
    number('reflectionShadowSamplesScale', 0.3, from(0.05)),
    number('shadowRayLengthKm', 15, from(0.01)),
    number('opaqueBelow', 0.005, [0, 1]),
    nonNegative('hazeRayleighStartKm', 0),
    nonNegative('hazeRayleighFadeKm', 0),
    number('hazeMieStartKm', 0, ANY),
    number('hazeMieFadeKm', 0, ANY),
    flag('alphaHole', false),
    flag('inMainView', true),
    flag('inSkyCapture', true),
  ] as const))()

/** What a host writes for the part: any of the layer's and the material's fields. */
export type CloudOptions = SettingOptions<typeof CLOUD_RULES> &
  SettingOptions<typeof CLOUD_MATERIAL_RULES>

/** Centimetres in a kilometre: the marcher traces in centimetres. */
const CM_PER_KM = 100000
/** The samples of a view ray and of a shadow ray at a scale of 1. */
const VIEW_SAMPLES = 96
const SHADOW_SAMPLES = 10
/** The most samples a ray takes whatever its scale: a view's, a reflection's, a shadow's, a
 *  reflection shadow's. */
const MOST_VIEW_SAMPLES = 768
const MOST_REFLECTION_SAMPLES = 80
const MOST_SHADOW_SAMPLES = 80
const MOST_REFLECTION_SHADOW_SAMPLES = 24
/** The fewest samples a ray takes. */
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
  readonly gpu: ReturnType<typeof gpuValues>
}

/** The settings as the marcher is given them, in the order it reads them: distances in
 *  centimetres, sample counts, the sky light's bottom visibility, the air's fades inverted. */
function gpuValues(layer: SettingValues<typeof CLOUD_RULES>) {
  return {
    undersideSkyKept: 1 - layer.undersideSkyLoss,
    farthestEntryCm: Math.max(0, CM_PER_KM * layer.farthestEntryKm),
    nearestStartCm: Math.max(0, CM_PER_KM * layer.nearestStartKm),
    marchLengthCm: Math.max(0, CM_PER_KM * layer.marchLengthKm),
    marchLengthFrom: TRACING_MODES.indexOf(layer.marchLengthFrom),
    viewSamplesMost: samples(layer.viewSamplesScale, VIEW_SAMPLES, MOST_VIEW_SAMPLES),
    shadowSamplesMost: samples(layer.shadowSamplesScale, SHADOW_SAMPLES, MOST_SHADOW_SAMPLES),
    shadowRayLengthCm: CM_PER_KM * Math.max(LEAST_SHADOW_DISTANCE_KM, layer.shadowRayLengthKm),
    reflectionSamplesMost: samples(
      layer.reflectionSamplesScale,
      VIEW_SAMPLES,
      MOST_REFLECTION_SAMPLES,
    ),
    reflectionShadowSamplesMost: samples(
      layer.reflectionShadowSamplesScale,
      SHADOW_SAMPLES,
      MOST_REFLECTION_SHADOW_SAMPLES,
    ),
    hazeRayleighFadeInverse: 1 / Math.max(layer.hazeRayleighFadeKm, FADE_FLOOR_KM),
    hazeMieFadeInverse: 1 / Math.max(layer.hazeMieFadeKm, FADE_FLOOR_KM),
  }
}

/** The radii of the shell round a planet of radius `planetRadiusKm`, in kilometres: the atmosphere's
 *  when there is one, else the part's `planetRadiusKm`. */
export const cloudLayerRadiiKm = (
  layer: SettingValues<typeof CLOUD_RULES>,
  planetRadiusKm: number,
) => {
  const bottom = planetRadiusKm + layer.baseAltitudeKm
  return { bottom, top: bottom + layer.thicknessKm }
}

/**
 * The one reading of the part's merged fields: the layer's and the material's settings, each its
 * default when the fields hold none, and what the marcher is told of them.
 * @throws TypeError naming a field the part does not have, or a value a field does not take.
 */
export function resolveCloudPart(fields: Readonly<Record<string, unknown>>): CloudPart {
  const names = [...Object.keys(CLOUD_RULES), ...Object.keys(CLOUD_MATERIAL_RULES)]
  const held = fieldsOf(fields, names, 'the clouds part', refusal('clouds'))
  const settings = resolveSettings(CLOUD_RULES, held)
  return {
    settings,
    material: resolveSettings(CLOUD_MATERIAL_RULES, held),
    gpu: gpuValues(settings),
  }
}
