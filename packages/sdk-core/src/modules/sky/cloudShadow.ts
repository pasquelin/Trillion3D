import { clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { fieldsOf, refusal } from '../../contracts/nameMatch.ts'
import {
  ANY_NUMBER as ANY,
  atLeast,
  flagSetting as flag,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  resolveSettings,
  rulesOf,
  type SettingValues,
  vectorSetting as vector,
} from '../../contracts/settingRules.ts'
import type { SkyQualityValues } from './quality.ts'

/**
 * The clouds' shadow map, one for each of the air's two lights: a map seen along the light, of the
 * depth where the cloud begins, the mean extinction behind it and the largest optical depth, that
 * the surfaces, the air and the fog read to be shadowed by the clouds. Run-time settings, as
 * `../../contracts/settingRules.ts` says. Distances are in kilometres, as written.
 *
 * The settings here (`CLOUD_SHADOW_LIGHT_RULES`) are the light component's, written on each of the
 * air's lights with the component's defaults. Every setting of the renderer, one for both lights,
 * is a quality setting of the sky module (`./quality.ts`): `cloudShadowMap`,
 * `cloudShadowMapResolutionMax`, `cloudShadowMapSamplesMax`, `cloudShadowMapHorizonMultiplier`,
 * `cloudShadowMapSpatialFiltering`, `cloudShadowMapNewFrameWeight`,
 * `cloudShadowMapLightRotationCutDegrees`, `cloudShadowMapSnapKm`, `cloudShadowMapSnapToPixelGrid`
 * and `cloudShadowMapLightDistanceOverrideKm`, which the functions below and the frame take.
 */

/**
 * The settings of a light by field:
 * - `shadowsClouds` (false): the cloud march reads the light's opaque shadow map where it samples the
 *   clouds' light (`cloudsReadOpaqueShadow`); the sky module's sun turns it on;
 * - `castCloudShadows` (false): the light has a map; `cloudShadowStrength` (1, from 0) is its
 *   weight on the map's extinction and optical depth, and a map with a strength of 0 is not made;
 * - `cloudShadowOnAtmosphereStrength` (1, from 0) and `cloudShadowOnSurfaceStrength` (1, from 0):
 *   how much of the shadow the air and the surfaces take; read by those, not by the map;
 * - `cloudShadowDepthBiasKm` (0): added to the depth where the cloud begins;
 * - `cloudShadowExtentKm` (150, from 1): the radius round the camera the map covers;
 * - `cloudShadowResolutionScale` (1, from 0.25): the factor on the map's 512 texels a side;
 * - `cloudShadowRaySamplesScale` (1, from 0.25): the factor on the 16 samples a ray of the map takes;
 * - `cloudScatteredLuminanceScale` (white): the factor on the light inside the clouds; read by the
 *   marcher, not by the map.
 */
export const CLOUD_SHADOW_LIGHT_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('shadowsClouds', false),
    flag('castCloudShadows', false),
    nonNegative('cloudShadowStrength', 1),
    nonNegative('cloudShadowOnAtmosphereStrength', 1),
    nonNegative('cloudShadowOnSurfaceStrength', 1),
    number('cloudShadowDepthBiasKm', 0, ANY),
    number('cloudShadowExtentKm', 150, atLeast(1)),
    number('cloudShadowResolutionScale', 1, atLeast(0.25)),
    number('cloudShadowRaySamplesScale', 1, atLeast(0.25)),
    vector('cloudScatteredLuminanceScale', [1, 1, 1]),
  ] as const))()

export type CloudShadowLight = SettingValues<typeof CLOUD_SHADOW_LIGHT_RULES>

/** The light's settings, each its default when the fields hold none.
 *  @throws TypeError naming a field the light does not have, or a value a field does not take. */
export const resolveCloudShadowLight = (fields: Readonly<Record<string, unknown>>) =>
  resolveSettings(
    CLOUD_SHADOW_LIGHT_RULES,
    fieldsOf(
      fields,
      Object.keys(CLOUD_SHADOW_LIGHT_RULES),
      'the cloud shadow of a light',
      refusal('cloud shadow'),
    ),
  )

/** Whether the cloud march reads the opaque shadow map of a light: the light asks for it
 *  (`shadowsClouds`) and is the air's first light (`sunIndex` 0), the second light never being read
 *  for it. */
export const cloudsReadOpaqueShadow = (light: CloudShadowLight, sunIndex: number) =>
  light.shadowsClouds && sunIndex === 0

/** A light's map is made when the maps are on, the light casts cloud shadows and its strength is
 *  above 0. `light` is none where the air has no such light. */
export const cloudShadowWanted = (
  quality: Pick<SkyQualityValues, 'cloudShadowMap'>,
  light: CloudShadowLight | undefined,
) =>
  quality.cloudShadowMap &&
  light !== undefined &&
  light.castCloudShadows &&
  light.cloudShadowStrength > 0

/** The side of the map of a light with none, in texels. */
const CLOUD_SHADOW_NO_LIGHT_SIDE = 32
/** The texels a side of a map has at a resolution scale of 1. */
const BASE_SIDE = 512
/** The samples a ray of the map takes at a scale of 1, and the fewest it takes. */
const BASE_SAMPLES = 16
const LEAST_SAMPLES = 4

/** The side of a map in texels: the base side times `scale`, cut to a whole number, at most
 *  `mostSide`, at least 1. The floor of 1 is ours: a largest side of 0 or less, which the
 *  quality setting lets through, would give a map of no texels, and WebGPU refuses to create a
 *  texture of size 0 (its size is also inverted for the sampling: infinity). */
export const mapSide = (scale: number, mostSide: number) =>
  clampLowWins(Math.trunc(BASE_SIDE * scale), 1, mostSide)

/** The side of a light's map in texels (`mapSide` of its resolution scale);
 *  `CLOUD_SHADOW_NO_LIGHT_SIDE` for no light. */
export const cloudShadowSide = (light: CloudShadowLight | undefined, mostSide: number) =>
  light === undefined
    ? CLOUD_SHADOW_NO_LIGHT_SIDE
    : mapSide(light.cloudShadowResolutionScale, mostSide)

/** The samples a ray of a light's map takes before the sun's low height adds to them: the base
 *  count times the light's scale, at most `mostSamples`, at least 4. */
export const cloudShadowBaseSamples = (light: CloudShadowLight, mostSamples: number) =>
  clampLowWins(BASE_SAMPLES * light.cloudShadowRaySamplesScale, LEAST_SAMPLES, mostSamples)
