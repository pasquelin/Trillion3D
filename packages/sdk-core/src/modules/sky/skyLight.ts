import { DEG2RAD, HALF_MAX } from '../../../../math/src/constants.ts'
import { nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { fieldsOf, refusal } from '../../contracts/nameMatch.ts'
import { LIGHT_MOBILITY } from '../../scene/light/contracts.ts'
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
  type SettingValues,
  vectorSetting as vector,
} from '../../contracts/settingRules.ts'
import type { SkyQualityValues } from './quality.ts'
import {
  resolveSkyLightCubemap,
  resolveSkyLightCubemapBlend,
  SKY_LIGHT_CUBEMAP_FIELDS,
  type SkyLightCubemap,
  type SkyLightCubemapBlend,
} from './skyLightCubemap.ts'

/**
 * The sky light part of the sky module: a light that captures the sky into a cube, filters the cube
 * by roughness for the reflections, and sums it into nine harmonics for the diffuse light. Run-time
 * settings, as `../../contracts/settingRules.ts` says. Every field has the component's default,
 * but `realTimeCapture`, `mobility` and `lowerHemisphereIsSolidColor`, which are those of the sky
 * module's sky light (a real-time capture, movable, the lower hemisphere the sky's own): the part's
 * defaults, those of a new level's sky light.
 *
 * A field a capture does not read says so below: it belongs to the light's other consumers (the
 * distance-field occlusion, the cloud occlusion, the ray-traced effects, the volumetric fog, the
 * cubemap of a source that is no capture) and is held here so that they read it from one place.
 */

const SOURCE_TYPES = ['capturedScene', 'specifiedCubemap'] as const
const OCCLUSION_COMBINES = ['minimum', 'multiply'] as const

/**
 * The light's own settings, by field:
 * - `realTimeCapture` (true; the component's is false) and `mobility` (`'movable'`; the
 *   component's is `'stationary'`): the sky is captured by the real-time capture when the flag is
 *   on and the light is movable or stationary (`isSkyLightCapturing`);
 * - `intensity` (1) and `color` (white, linear): the light's colour is their product;
 * - `volumetricScatteringIntensity` (1): read by the volumetric fog, not by the capture;
 * - `cubemapResolution` (128): the cube's side, made a power of two between 8 and the limits
 *   (`skyLightCubeWidth`);
 * - `lowerHemisphereIsSolidColor` (false; the component's is true),
 *   `lowerHemisphereColor` (black, linear) and `lowerHemisphereCoverage` (1, from 0 to 1, the
 *   colour's alpha): where the flag is on, every direction below the horizon is that colour, by
 *   that share, the sky and the clouds there showing through what is left; off, they are the sky's;
 * - `sourceType` (`'capturedScene'`), `sourceCubemapAngle` (0, degrees), `skyDistanceThreshold`
 *   (150000 cm), `captureEmissiveOnly` (false): the static sources', which the real-time capture
 *   replaces (`skyLightSource`). A specified cubemap reads the angle (`skyLightCubemapRotation`);
 *   the captured scene reads the distance (the near plane of its faces, in centimetres) and the
 *   emissive flag (only what the surfaces emit is captured); it is drawn for a light that is not
 *   static and affects the world (`skyLightSource`);
 * - `cubemap` and `cubemapBlend`, the fields that are no setting: the picture of a specified cubemap
 *   and the one it blends to, as data (`./skyLightCubemap.ts`), read only where the source is the
 *   specified cubemap;
 * - `occlusionMaxDistance` (1000), `contrast` (0), `occlusionExponent` (1), `minOcclusion` (0),
 *   `occlusionTint` (black), `occlusionCombineMode` (`'minimum'`): the distance-field occlusion's;
 * - `cloudAmbientOcclusion` (false), `cloudAmbientOcclusionStrength` (1, from 0),
 *   `cloudAmbientOcclusionExtentKm` (150, from 1), `cloudAmbientOcclusionMapResolutionScale` (1, from
 *   0.25), `cloudAmbientOcclusionApertureScale` (0.05, 0 to 1): the clouds' occlusion of the sky
 *   within the atmosphere, which progressively fades the multiple scattering of the air's first
 *   light out under the clouds (not the sky light's own diffuse and specular light: the capture,
 *   the cube and its harmonics do not read it), with the ranges the component clamps them to. When
 *   the flag is on a map is built, `extentKm` its radius round the camera, `mapResolutionScale`
 *   the factor on its 512 texels a side, `strength` how much light it blocks, `apertureScale` the
 *   cone, from the vertical, its hemisphere filter takes in (0 one direction, sharp, 1 the whole
 *   hemisphere, blurry) (`./cloudSkyOcclusion.ts` reads them);
 * - `affectsWorld`, `castShadows`, `castVolumetricShadow` (all true): the light's switches.
 *
 * Three of the component's settings are not here because nothing of this engine reads them: the
 * indirect lighting intensity and the samples per pixel are read by ray-traced and path-traced
 * lighting alone, the switches of whether the light affects the reflections and the global
 * illumination by the ray-traced reflections alone (and the second by nothing at all).
 */
export const SKY_LIGHT_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('realTimeCapture', true),
    choice('mobility', 'movable', LIGHT_MOBILITY),
    number('intensity', 1, ANY),
    vector('color', [1, 1, 1]),
    number('volumetricScatteringIntensity', 1, ANY),
    integer('cubemapResolution', 128, atLeast(1)),
    flag('lowerHemisphereIsSolidColor', false),
    vector('lowerHemisphereColor', [0, 0, 0]),
    number('lowerHemisphereCoverage', 1, [0, 1]),
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
  ] as const))()

/** The light's settings as resolved. */
export type SkyLightSettings = SettingValues<typeof SKY_LIGHT_RULES>

/** The part as the capture reads it: the light's settings, and the sky's quality settings
 *  (`./quality.ts`) that hold the capture's settings; the specified cubemap and the blend, where
 *  the fields give them. */
export interface SkyLightPart {
  readonly light: SkyLightSettings
  readonly quality: SkyQualityValues
  readonly cubemap?: SkyLightCubemap
  readonly cubemapBlend?: SkyLightCubemapBlend
}

/**
 * The one reading of the part's merged fields: the light's settings, each its default when the
 * fields hold none, with the sky's `quality` settings.
 * @throws TypeError naming a field the part does not have, or a value a field does not take.
 */
export function resolveSkyLight(
  fields: Readonly<Record<string, unknown>>,
  quality: SkyQualityValues,
): SkyLightPart {
  const refuse = refusal('skyLight')
  const held = fieldsOf(
    fields,
    [...Object.keys(SKY_LIGHT_RULES), ...SKY_LIGHT_CUBEMAP_FIELDS],
    'the sky light part',
    refuse,
  )
  return {
    light: resolveSettings(SKY_LIGHT_RULES, held),
    quality,
    ...(held.cubemap !== undefined && {
      cubemap: resolveSkyLightCubemap(held.cubemap, 'cubemap', refuse),
    }),
    ...(held.cubemapBlend !== undefined && {
      cubemapBlend: resolveSkyLightCubemapBlend(held.cubemapBlend, refuse),
    }),
  }
}

/** The part under other quality settings: the same light, cubemap and blend (what the frame does
 *  where a quality setting moves). */
export const skyLightPartAt = (part: SkyLightPart, quality: SkyQualityValues): SkyLightPart => ({
  ...part,
  quality,
})

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

/** The lower hemisphere's colour with its coverage as the fourth lane, what the capture's copy and
 *  composition mix the directions under the horizon with. */
export const lowerHemisphereOf = (light: SkyLightSettings) => [
  ...light.lowerHemisphereColor,
  light.lowerHemisphereCoverage,
]

/** Whether the sky light captures the sky in real time: the flag on, the light movable or
 *  stationary, and the platform allowing it. */
const isSkyLightCapturing = (part: SkyLightPart) =>
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

/**
 * The scales of a 32-bit float cubemap whose brightest channel is `peak`: past the half float's
 * range the cube is written times `cube` (the range over the peak) so that it fits, and the light's
 * colour is multiplied by `light` (the peak over the range) to give back the original luminance.
 * Within the range both are 1.
 */
export const skyLightCubemapScales = (peak: number) =>
  peak > HALF_MAX ? { cube: HALF_MAX / peak, light: peak / HALF_MAX } : { cube: 1, light: 1 }

/** The scales of a cubemap, or of a pair of them (`skyLightCubemapScales`). */
export type SkyLightCubemapFit = ReturnType<typeof skyLightCubemapScales>

/** The smallest side of the cube the light sanitises to. */
const LEAST_CUBE_WIDTH = 8
/** The smallest `skyLightResolutionOverride` that replaces the cube's side. */
const LEAST_OVERRIDE = 16

/**
 * The side of the captured cube. The light's `cubemapResolution` is made a power of two, at least
 * 8 and at most the device's largest cube side `deviceCubeMax` — or, when the quality's
 * `skyLightCubemapMaxResolution` is above 0, that value held between 8 and the device's. Where the
 * light captures its sky in real time (`skyLightSource`), a `skyLightResolutionOverride` of 16 or
 * more replaces the light's side as it is, not made a power of two, held to the device's largest
 * side alone; a captured scene and a specified cubemap keep the light's own side.
 */
export function skyLightCubeWidth(part: SkyLightPart, deviceCubeMax: number) {
  const { skyLightCubemapMaxResolution: cubemapMaxResolution, skyLightResolutionOverride } =
    part.quality
  if (skyLightSource(part) === 'realTime' && skyLightResolutionOverride >= LEAST_OVERRIDE)
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
 * the quality's `skyLightIntensityScale`. A real-time capture is written multiplied by
 * `capturePreExposure` (`cachedPreExposure`, the exposure options' `cachedLightingPreExposure`),
 * so the colour is multiplied by its inverse there, once, for every reader of the cube and the
 * harmonics; any other source is written at a pre-exposure of 1 and the colour applies as it is.
 * Black when the sky lighting is off (`skyLighting`). `cubemapScale` is the rescale of a cubemap
 * written to fit the half float (`skyLightCubemapScales(...).light`), 1 for every other source.
 */
export function skyLightColor(
  part: SkyLightPart,
  skyLighting: boolean,
  cubemapScale = 1,
  capturePreExposure = 1,
): [number, number, number] {
  const { color, intensity } = part.light
  const written = skyLightSource(part) === 'realTime' ? capturePreExposure : 1
  const scale = skyLighting
    ? (intensity * part.quality.skyLightIntensityScale * cubemapScale) / written
    : 0
  return [color[0] * scale, color[1] * scale, color[2] * scale]
}
