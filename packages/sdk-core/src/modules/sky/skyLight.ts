import { DEG2RAD } from '../../../../math/src/constants.ts'
import { nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { fieldsOf, refusal } from '../../contracts/nameMatch.ts'
import {
  ANY_NUMBER as ANY,
  atLeast,
  choiceSetting as choice,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  resolveSettings,
  rulesOf,
  type SettingOptions,
  type SettingValues,
  vectorSetting as vector,
} from '../../contracts/settingRules.ts'
import { SKY_QUALITY_RULES, type SkyQualityValues } from './quality.ts'

/**
 * The sky light part of the sky module: a light that captures the sky into a cube, filters the cube
 * by roughness for the reflections, and sums it into nine harmonics for the diffuse light. Run-time
 * settings, as `../../contracts/settingRules.ts` says. Every field has the component's default,
 * but `realTimeCapture` and `mobility`, which are those of the sky module's sky light (a real-time
 * capture, movable): the part's defaults.
 *
 * A field a capture does not read says so below: it belongs to the light's other consumers (the
 * distance-field occlusion, the cloud occlusion, the ray-traced effects, the volumetric fog, the
 * cubemap of a source that is no capture) and is held here so that they read it from one place.
 */

/** From `low` up, a finite number. */
const from = (low: number): readonly [number, number] => [low, ANY[1]]

const MOBILITIES = ['static', 'stationary', 'movable'] as const
const SOURCE_TYPES = ['capturedScene', 'specifiedCubemap'] as const
const OCCLUSION_COMBINES = ['minimum', 'multiply'] as const

/**
 * The light's own settings, by field:
 * - `realTimeCapture` (true; the component's is false) and `mobility` (`'movable'`; the
 *   component's is `'stationary'`): the sky is captured by the real-time capture when the flag is
 *   on and the light is movable or stationary (`isSkyLightCapturing`);
 * - `intensity` (1) and `color` (white, linear): the light's colour is their product;
 * - `indirectLightingIntensity` (1), `volumetricScatteringIntensity` (1): read by the global
 *   illumination and the volumetric fog, not by the capture;
 * - `cubemapResolution` (128): the cube's side, made a power of two between 8 and the limits
 *   (`skyLightCubeWidth`);
 * - `lowerHemisphereIsSolidColor` (true; the component calls it `bLowerHemisphereIsBlack`) and
 *   `lowerHemisphereColor` (black, linear): every direction below the horizon is that colour;
 * - `sourceType` (`'capturedScene'`), `sourceCubemapAngle` (0, degrees), `skyDistanceThreshold`
 *   (150000 cm), `captureEmissiveOnly` (false): the static sources', which the real-time capture
 *   replaces (`skyLightSource`). A specified cubemap reads the angle (`skyLightCubemapRotation`);
 *   the captured scene reads the distance (the near plane of its faces, in centimetres) and the
 *   emissive flag (only what the surfaces emit is captured); it is drawn for a light that is not
 *   static and affects the world (`skyLightSource`);
 * - `occlusionMaxDistance` (1000), `contrast` (0), `occlusionExponent` (1), `minOcclusion` (0),
 *   `occlusionTint` (black), `occlusionCombineMode` (`'minimum'`): the distance-field occlusion's;
 * - `cloudAmbientOcclusion` (false), `cloudAmbientOcclusionStrength` (1, from 0),
 *   `cloudAmbientOcclusionExtentKm` (150, from 1), `cloudAmbientOcclusionMapResolutionScale` (1, from
 *   0.25), `cloudAmbientOcclusionApertureScale` (0.05, 0 to 1): the clouds' occlusion of the sky
 *   light's, with the ranges the component clamps them to (`./cloudSkyOcclusion.ts` reads them);
 * - `affectsWorld`, `castShadows`, `castVolumetricShadow`, `affectReflection`,
 *   `affectGlobalIllumination` (all true), `samplesPerPixel` (4): the light's switches.
 */
export const SKY_LIGHT_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('realTimeCapture', true),
    choice('mobility', 'movable', MOBILITIES),
    number('intensity', 1, ANY),
    vector('color', [1, 1, 1]),
    number('indirectLightingIntensity', 1, ANY),
    number('volumetricScatteringIntensity', 1, ANY),
    integer('cubemapResolution', 128, from(1)),
    flag('lowerHemisphereIsSolidColor', true),
    vector('lowerHemisphereColor', [0, 0, 0]),
    choice('sourceType', 'capturedScene', SOURCE_TYPES),
    number('sourceCubemapAngle', 0, ANY),
    number('skyDistanceThreshold', 150000, ANY),
    flag('captureEmissiveOnly', false),
    number('occlusionMaxDistance', 1000, ANY),
    number('contrast', 0, ANY),
    number('occlusionExponent', 1, ANY),
    number('minOcclusion', 0, ANY),
    vector('occlusionTint', [0, 0, 0]),
    choice('occlusionCombineMode', 'minimum', OCCLUSION_COMBINES),
    flag('cloudAmbientOcclusion', false),
    nonNegative('cloudAmbientOcclusionStrength', 1),
    number('cloudAmbientOcclusionExtentKm', 150, atLeast(1)),
    number('cloudAmbientOcclusionMapResolutionScale', 1, atLeast(0.25)),
    number('cloudAmbientOcclusionApertureScale', 0.05, [0, 1]),
    flag('affectsWorld', true),
    flag('castShadows', true),
    flag('castVolumetricShadow', true),
    flag('affectReflection', true),
    flag('affectGlobalIllumination', true),
    integer('samplesPerPixel', 4, from(1)),
  ] as const))()

/** What a host writes for the part: any of the light's fields. */
export type SkyLightOptions = SettingOptions<typeof SKY_LIGHT_RULES>

/** The light's settings as resolved. */
export type SkyLightSettings = SettingValues<typeof SKY_LIGHT_RULES>

/** The part as the capture reads it: the light's settings, and the sky's quality settings
 *  (`./quality.ts`) that hold the reference's console variables of the capture. */
export interface SkyLightPart {
  readonly light: SkyLightSettings
  readonly quality: SkyQualityValues
}

/**
 * The one reading of the part's merged fields: the light's settings, each its default when the
 * fields hold none, with the sky's `quality` settings, their defaults when none is given.
 * @throws TypeError naming a field the part does not have, or a value a field does not take.
 */
export function resolveSkyLight(
  fields: Readonly<Record<string, unknown>>,
  quality: SkyQualityValues = resolveSettings(SKY_QUALITY_RULES, {}),
): SkyLightPart {
  const held = fieldsOf(
    fields,
    Object.keys(SKY_LIGHT_RULES),
    'the sky light part',
    refusal('skyLight'),
  )
  return { light: resolveSettings(SKY_LIGHT_RULES, held), quality }
}

/**
 * What the distance-field occlusion reads of the light, held to the ranges the reference holds
 * them to: the contrast to 0.01 .. 2, the exponent to 0.1 .. 10, the least occlusion to 0 .. 1, the
 * distance to 2 .. 3000 (`../../lighting/globalDistanceField.ts`, `occlusionDistances`, splits it
 * between the meshes' fields and the global one).
 */
export const skyLightOcclusion = (part: SkyLightPart) => ({
  maxDistance: clamp(part.light.occlusionMaxDistance, 2, 3000),
  contrast: clamp(part.light.contrast, 0.01, 2),
  exponent: clamp(part.light.occlusionExponent, 0.1, 10),
  minOcclusion: clamp(part.light.minOcclusion, 0, 1),
  tint: part.light.occlusionTint,
  combineMode: part.light.occlusionCombineMode,
})

/**
 * The scale and bias that bring the occlusion's contrast curve, `1 / (1 + e^(-contrast · (10 · visibility - 5)))`,
 * back to 0 at no visibility and 1 at all of it: `1 / (max - min)` and `-min / (max - min)`, `min` and `max` the curve at
 * 0 and at 1. The `contrast` is the light's, held to its range (`skyLightOcclusion`).
 */
export function skyLightContrastCurve(contrast: number) {
  const low = 1 / (1 + Math.exp(-contrast * -5))
  const high = 1 / (1 + Math.exp(-contrast * 5))
  return { mul: 1 / (high - low), add: -low / (high - low) }
}

/** Whether the sky light captures the sky in real time: the flag on, the light movable or
 *  stationary, and the platform allowing it. */
export const isSkyLightCapturing = (part: SkyLightPart) =>
  part.light.realTimeCapture &&
  (part.light.mobility === 'movable' || part.light.mobility === 'stationary') &&
  part.quality.skyLightRealTimeCapture

/**
 * Where the light's sky comes from: `'realTime'` when it captures in real time, which replaces the
 * source type; else the source type's own, `'specifiedCubemap'` (the host's cube) or
 * `'capturedScene'` (the scene drawn into the cube from the light's position, between two frames).
 */
export const skyLightSource = (part: SkyLightPart) =>
  isSkyLightCapturing(part) ? ('realTime' as const) : part.light.sourceType

/** The angle the specified cubemap is turned about the up axis, in radians. */
export const skyLightCubemapRotation = (part: SkyLightPart) =>
  part.light.sourceCubemapAngle * DEG2RAD

/** The largest finite half float: what a 16-bit cube holds. */
export const HALF_FLOAT_MAX = 65504

/**
 * The scales of a 32-bit float cubemap whose brightest channel is `peak`: past the half float's
 * range the cube is written times `cube` (the range over the peak) so that it fits, and the light's
 * colour is multiplied by `light` (the peak over the range) to give back the original luminance.
 * Within the range both are 1.
 */
export const skyLightCubemapScales = (peak: number) =>
  peak > HALF_FLOAT_MAX
    ? { cube: HALF_FLOAT_MAX / peak, light: peak / HALF_FLOAT_MAX }
    : { cube: 1, light: 1 }

/** The smallest side of the cube the light sanitises to. */
const LEAST_CUBE_WIDTH = 8
/** The smallest `skyLightResolutionOverride` that replaces the cube's side. */
const LEAST_OVERRIDE = 16

/**
 * The side of the captured cube. The light's `cubemapResolution` is made a power of two, at least
 * 8 and at most the device's largest cube side `deviceCubeMax` — or, when the quality's
 * `skyLightCubemapMaxResolution` is above 0, that value held between 8 and the device's. A
 * `skyLightResolutionOverride` of 16 or more replaces the light's side as it is, not made a power of
 * two, held to the device's largest side alone.
 */
export function skyLightCubeWidth(part: SkyLightPart, deviceCubeMax: number) {
  const { skyLightCubemapMaxResolution: cubemapMaxResolution, skyLightResolutionOverride } =
    part.quality
  if (skyLightResolutionOverride >= LEAST_OVERRIDE)
    return Math.min(Math.trunc(skyLightResolutionOverride), deviceCubeMax)
  const most =
    cubemapMaxResolution > 0
      ? clamp(cubemapMaxResolution, LEAST_CUBE_WIDTH, deviceCubeMax)
      : deviceCubeMax
  return clamp(nextPow2(part.light.cubemapResolution), LEAST_CUBE_WIDTH, most)
}

/** The mips of a cube of side `width`: its levels down to one texel. */
export const skyLightMipCount = (width: number) => Math.ceil(Math.log2(width)) + 1

/** The side of the texture the clouds of one face are traced into, `width` over the divider. */
export const skyLightCloudWidth = (width: number, part: SkyLightPart) =>
  Math.floor(width / part.quality.skyLightCloudDivider)

/**
 * The colour the sky light gives what it lights: the light's colour times its intensity, times
 * the quality's `skyLightIntensityScale`. The capture is written at a pre-exposure of 1, as every
 * view that runs no post is, so the colour is applied as it is. Black when the sky
 * lighting is off (`skyLighting`). `cubemapScale` is the rescale of a 32-bit float cubemap
 * (`skyLightCubemapScales(...).light`), 1 for every other source.
 */
export function skyLightColor(
  part: SkyLightPart,
  skyLighting: boolean,
  cubemapScale = 1,
): [number, number, number] {
  const { color, intensity } = part.light
  const scale = skyLighting ? intensity * part.quality.skyLightIntensityScale * cubemapScale : 0
  return [color[0] * scale, color[1] * scale, color[2] * scale]
}
