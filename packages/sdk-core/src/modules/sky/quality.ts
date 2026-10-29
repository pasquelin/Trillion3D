import {
  ANY_NUMBER,
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
} from '../../contracts/settingRules.ts'
import { IMAGE_EFFECTS_RULES, INDIRECT_LIGHT_RULES } from './qualityLight.ts'
import { INT32, INT32_FROM_ZERO, TABLE_SIDE } from './qualityRanges.ts'

/**
 * The quality settings of the sky module: the switches of the renderer for the atmosphere, the
 * clouds, the light shafts and the sky light, one run-time family (`../../contracts/settingRules.ts`
 * says what that is). They sit in the quality groups the reference writes them in: the atmosphere
 * and the clouds in the effects group, the light shafts in the image effects group (the
 * post-processing one) and the sky light in the indirect light group (the global illumination one)
 * (`SKY_QUALITY_RULES_BY_GROUP`). The presets write the settings the reference's
 * quality levels write: `smooth`, `balanced`, `fine` the levels 0, 1 and 2 (`SKY_PRESET_LEVELS`),
 * `max` nothing — the level 3, which the reference draws at when none is chosen, is each setting's
 * default here —, and `cinematic` the level above it (`SKY_PRESET_LEVELS`).
 */

/** The ways the clouds are traced at a reduced size and brought back to the view's, in the order
 *  the shader is told them: traced at a quarter of the size and rebuilt at half, then enlarged;
 *  traced at half, then enlarged; traced at a quarter and rebuilt at the full size (a cloud cannot
 *  hide behind an opaque mesh in this one); traced at the full size, with nothing rebuilt. */
export const CLOUD_TRACE_SIZES = ['quarterToHalf', 'half', 'quarterToFull', 'full'] as const

/** The ways the traced clouds are laid over the scene, in the order the shader is told them:
 *  bilinear; bilinear with a jitter; the nearest with a depth test; bilinear with a jitter keeping
 *  the closest; bilateral. The two reduced-size traces that rebuild at the full size or trace at
 *  the full size read the nearest with a depth test whatever is asked. */
export const CLOUD_UPSAMPLINGS = [
  'bilinear',
  'bilinearJitter',
  'nearestDepth',
  'bilinearJitterClosest',
  'bilateral',
] as const

/** The centimetres in a kilometre. */
export const CM_PER_KM = 100000

/** The air: its switches, samples and tables. */
const AIR_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('atmosphereOn', true),
    flag('cloudsOn', true),
    flag('skyTableFast', true),
    flag('aerialFastOnOpaque', true),
    number('atmosphereSamplesMin', 4, atLeast(1)),
    number('atmosphereSamplesMax', 128, atLeast(1)),
    number('atmosphereDistanceToMaxSamplesKm', 150, atLeast(1e-4)),
    flag('atmosphereSampleLightShadowMap', true),
    number('skyTableSamplesMin', 4, atLeast(1)),
    number('skyTableSamplesMax', 128, atLeast(1)),
    number('skyTableDistanceToMaxSamplesKm', 150, atLeast(1e-4)),
    number('aerialSamplesPerSlice', 4, atLeast(1)),
    integer('aerialDepthSlices', 16, TABLE_SIDE),
    number('aerialDepthKm', 96, atLeast(1)),
    integer('aerialWidth', 32, TABLE_SIDE),
    flag('aerialDepthTest', true),
    number('transmittanceSamples', 10, atLeast(1)),
    number('multiScatterSamples', 15, atLeast(1)),
    flag('transmittanceSmallFormat', false),
    flag('transmittanceTable', true),
    flag('distantSkyLightTable', true),
    flag('multiScatterHighQuality', false),
    number('distantSkyLightAltitudeKm', 6, ANY_NUMBER),
    flag('skyTablesFullPrecision', false),
    integer('transmittanceWidth', 256, TABLE_SIDE),
    integer('transmittanceHeight', 64, TABLE_SIDE),
    integer('multiScatterWidth', 32, TABLE_SIDE),
    integer('multiScatterHeight', 32, TABLE_SIDE),
    integer('skyTableWidth', 192, TABLE_SIDE),
    integer('skyTableHeight', 104, TABLE_SIDE),
  ] as const))()

/** The clouds: the samples, the light they gather and the lamps. */
const CLOUD_SAMPLING_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    number('cloudViewSamplesMax', 768, ANY_NUMBER),
    number('cloudReflectionSamplesMax', 80, ANY_NUMBER),
    number('cloudShadowSamplesMax', 80, ANY_NUMBER),
    number('cloudReflectionShadowSamplesMax', 24, ANY_NUMBER),
    integer('cloudSamplesMin', 2, INT32_FROM_ZERO),
    integer('cloudSamplesClamp', INT32[1], INT32_FROM_ZERO),
    number('cloudDistanceToMaxSamplesKm', 15, atLeast(1 / CM_PER_KM)),
    integer('cloudStepOnEmpty', 1, [1, INT32[1]]),
    flag('cloudSampleLightShadowMap', true),
    flag('cloudAerialPerspective', true),
    flag('cloudAtmosphericLights', true),
    flag('cloudDistantSkyLight', true),
    flag('cloudHighQualityAerial', false),
    flag('cloudFogOnAllPixels', false),
    flag('cloudLocalLights', false),
    number('cloudLocalLightShadowSamples', 12, ANY_NUMBER),
  ] as const))()

/** The clouds: the shadow map and the sky occlusion. */
const CLOUD_SHADOW_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('cloudShadowMap', true),
    flag('cloudShadowOnTranslucent', false),
    integer('cloudShadowMapResolutionMax', 2048, INT32),
    number('cloudShadowMapSamplesMax', 128, ANY_NUMBER),
    number('cloudShadowMapHorizonMultiplier', 2, atLeast(1)),
    integer('cloudShadowMapSpatialFiltering', 1, INT32),
    number('cloudShadowMapNewFrameWeight', 1, ANY_NUMBER),
    number('cloudShadowMapLightRotationCutDegrees', 10, ANY_NUMBER),
    number('cloudShadowMapSnapKm', 20, ANY_NUMBER),
    flag('cloudShadowMapSnapToPixelGrid', true),
    flag('cloudShadowMapDebug', false),
    number('cloudShadowMapLightDistanceOverrideKm', 0, ANY_NUMBER),
    flag('cloudSkyAO', true),
    integer('cloudSkyAOResolutionMax', 2048, INT32),
    integer('cloudSkyAOTraceSamples', 10, INT32),
    flag('cloudSkyAOFiltering', true),
    number('cloudSkyAOSnapKm', 20, ANY_NUMBER),
    flag('cloudSkyAODebug', false),
  ] as const))()

/** The clouds: the empty-space table, the traced size, the reprojection and the late fog. */
const CLOUD_TARGET_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('cloudEmptySpaceSkipping', false),
    number('cloudEmptySpaceSkippingDepthKm', 40, ANY_NUMBER),
    number('cloudEmptySpaceSkippingSliceBias', 0, ANY_NUMBER),
    flag('cloudEmptySpaceSkippingCorners', true),
    choice('cloudTraceSize', 'quarterToHalf', CLOUD_TRACE_SIZES),
    flag('cloudRenderTarget', true),
    choice('cloudUpsampling', 'bilateral', CLOUD_UPSAMPLINGS),
    number('cloudRenderTargetScale', 1, ANY_NUMBER),
    flag('cloudReprojectionBoxConstraint', false),
    nonNegative('cloudReprojectionMinDistanceKm', 0),
    nonNegative('cloudDisocclusionMaxDistanceKm', 5),
    flag('cloudFogLate', true),
    flag('cloudFogLateOnTranslucent', false),
    number('cloudSoftBlendingDistanceOnTranslucent', 0.5, ANY_NUMBER),
  ] as const))()

/**
 * The atmosphere's and the clouds' settings by field, each with the default of the reference's
 * level 3. Where that differs from the renderer's own default, it is noted `(…)`. A setting the
 * reference reads without a clamp takes the whole range of its type; one it clamps takes the
 * range of the type and is held to the clamp where it is read (`read from … to …` below), as the
 * reference holds it; a setting the reference does not clamp but whose meaning has bounds takes
 * those bounds as its range, a value beyond them refused.
 * - `atmosphereOn` (on), `cloudsOn` (on): whether the atmosphere and the clouds are drawn at all;
 * - `skyTableFast` (on): the sky is read from a table of the view's directions, not marched per
 *   pixel; faster, but an earth shadow or a scattering lobe in the sky shows artefacts; off, every
 *   pixel of the sky is marched through the air, its samples jittered by the blue noise;
 *   `aerialFastOnOpaque` (on): the haze on opaque surfaces is read from the low-resolution
 *   volume of the haze on translucent ones; the same artefacts; off, a pass over the lit image
 *   marches the haze of each pixel a surface was drawn on, from the eye to its depth, the samples
 *   jittered by the blue noise and the air's lights shaded by the shadow maps and the clouds — the
 *   translucent surfaces read the volume either way;
 * - `atmosphereSamplesMin` (4, 2 at the renderer) and `atmosphereSamplesMax` (128, 32), `skyTableSamplesMin` (4)
 *   and `skyTableSamplesMax` (128, 32): the samples of a march through the air (the marched sky
 *   pixel's, the sky table's), from 1, and from the minimum; the count grows with the distance to
 *   the maximum, itself no more than 32 times the atmosphere's `sampleCountScale`;
 *   `atmosphereDistanceToMaxSamplesKm` and `skyTableDistanceToMaxSamplesKm` (150), from 0.0001:
 *   the distance, in kilometres, at which a march takes its maximum;
 * - `atmosphereSampleLightShadowMap` (on): the sky table's and the haze volume's marches read the
 *   shadow map of a light that asks for it (`SceneLight.shadowsAir`), for the shadows the air shows;
 * - `aerialSamplesPerSlice` (4, 2), from 1: the most samples a slice of the haze volume takes;
 *   `aerialDepthSlices` (16), from 4: the slices along the depth; `aerialDepthKm` (96), from 1: the
 *   volume's length in kilometres, the last slice being used beyond; `aerialWidth` (32), from 4:
 *   its side in texels, the volume's cells held to what the light buffer has room for (32768, or
 *   16384 at `skyTablesFullPrecision`: the slices are cut first); `aerialDepthTest` (on): a surface
 *   at or before where the haze starts skips the read;
 * - `transmittanceSamples` (10) and `multiScatterSamples` (15), from 1: the samples that build
 *   the transmittance table and the multiple-scattering one; `transmittanceSmallFormat` (off): the
 *   transmittance table in four 8-bit channels, at lower quality; `transmittanceTable` (on),
 *   `distantSkyLightTable` (on): whether the transmittance table and the table of the distant sky
 *   light are built (off, the air answers as clear toward a light and the fog's sky is black);
 *   `multiScatterHighQuality` (off): the multiple scattering is built from 8 directions over the
 *   sphere and not from two; `distantSkyLightAltitudeKm` (6): the altitude, in kilometres, the
 *   distant sky light is integrated at, every image; `skyTablesFullPrecision` (off): the haze
 *   volume's cells in four 32-bit floats and not four half floats — the one table the reference's
 *   switch changes, though it names them all;
 * - `transmittanceWidth` (256), `transmittanceHeight` (64), `multiScatterWidth` (32),
 *   `multiScatterHeight` (32), `skyTableWidth` (192), `skyTableHeight` (104), from 4: the sides of
 *   the tables, in texels;
 * - `cloudViewSamplesMax` (768), `cloudReflectionSamplesMax` (80), from 2: the most samples a
 *   view ray and a ray seen in a reflection take; `cloudShadowSamplesMax` (80) and
 *   `cloudReflectionShadowSamplesMax` (24): the same for a shadow ray; a count under 2 is read as 2;
 * - `cloudSamplesMin` (2), a whole number from 0: the fewest samples a ray takes, so that a layer
 *   used as low fog stays fine near the eye; `cloudSamplesClamp` (2147483647), a whole number from
 *   0: the most samples a ray takes once its count is worked out, to keep a long ray from holding
 *   the GPU; `cloudDistanceToMaxSamplesKm` (15), from 0.00001: the distance, in kilometres, over
 *   which the count grows from its minimum to its maximum;
 * - `cloudStepOnEmpty` (1), a whole number from 1: the march's step, in samples, where the density
 *   bound is zero — more is faster but bands;
 * - `cloudSampleLightShadowMap` (on): the clouds read the light's shadow map; `cloudAerialPerspective`
 *   (on), `cloudAtmosphericLights` (on), `cloudDistantSkyLight` (on): the haze, the sun and the
 *   moon, and the distant sky light light the clouds; `cloudHighQualityAerial` (off): the haze on
 *   the clouds is traced per pixel in a second pass, not read from its volume; `cloudFogOnAllPixels`
 *   (off): the fog is applied where the clouds do not cover as well, which removes a jump where the
 *   coverage reaches 0; `cloudLocalLights` (off): the lamps light the clouds, which is dear;
 *   `cloudLocalLightShadowSamples` (12), read from 0 to 128: the samples of the shadow of a lamp;
 * - `cloudShadowOnTranslucent` (off): the clouds' shade of the forward directional light (the one of
 *   the highest `forwardShadingPriority`, then the brightest) also lights the translucent surfaces,
 *   per vertex (`../../../../sdk-browser/src/blend/cloudShade.ts`): read once, when the session
 *   opens, it picks the translucent programs' text, as the project switch it is; off, they hold none
 *   of it;
 * - `cloudShadowMap` (on): the sun's clouds shadow map is built; `cloudShadowMapResolutionMax` (2048):
 *   the largest side of the clouds' shadow map; `cloudShadowMapSamplesMax` (128): the most
 *   samples a ray of that map takes, read no lower than 4; `cloudShadowMapHorizonMultiplier` (2), from 1: the factor on
 *   that count when the sun reaches the horizon; `cloudShadowMapSpatialFiltering` (1), read from 0
 *   to 4: the blur passes smoothing it; `cloudShadowMapNewFrameWeight` (1), read from 0 to 1: the share of the
 *   current image in the map's temporal blend, 1 none; `cloudShadowMapLightRotationCutDegrees` (10):
 *   the turn of the sun, in degrees, past which that blend starts again;
 *   `cloudShadowMapSnapKm` (20): the length, in kilometres, the map's position is snapped to so it
 *   does not flicker; `cloudShadowMapSnapToPixelGrid` (on): the map's origin is snapped to its
 *   texels; `cloudShadowMapLightDistanceOverrideKm` (0): above 0, the distance of the light from
 *   the ground, in kilometres; `cloudShadowMapDebug` (off): the first light's map is drawn over the
 *   image, its frustum in orange and a quad for each texel holding cloud, with the map's sample count
 *   in text;
 * - `cloudSkyAO` (on): the clouds' sky occlusion map is built, for a sky light that asks for it
 *   (`cloudAmbientOcclusion`), and the air's marches dim the first light's multiple scattering by
 *   it; `cloudSkyAOResolutionMax` (2048): the largest side of its map; `cloudSkyAOTraceSamples`
 *   (10): the samples that find the ground's occlusion; `cloudSkyAOFiltering` (on): the map is
 *   dilated and smoothed, integrated over the hemisphere above each texel; `cloudSkyAOSnapKm` (20): the length, in
 *   kilometres, its position is snapped to; `cloudSkyAODebug` (off): the map is drawn over the image,
 *   its frustum in blue and a quad for each texel holding cloud;
 * - `cloudEmptySpaceSkipping` (off): a table of where the clouds start, built each image before the
 *   tracing, lets the rays begin their march there (never in a reflection). The built-in material
 *   leaves the table's input unconnected, and an unconnected input says "matter is there" in every
 *   slice: the table then holds the first slice's start moved by the bias, 0 by default, and the
 *   image is the one without the table, for the cost of the pass;
 *   `cloudEmptySpaceSkippingDepthKm` (40), read from 1: the distance, in kilometres, it covers;
 *   `cloudEmptySpaceSkippingSliceBias` (0): the slices its start is moved by, -1 one slice toward
 *   the eye; `cloudEmptySpaceSkippingCorners` (on): the corners of a cell are read as well as its
 *   centre;
 * - `cloudTraceSize` (`'quarterToHalf'`, `CLOUD_TRACE_SIZES`): the size the clouds are traced at;
 *   `cloudRenderTarget` (on): the clouds are traced into their own target at that size, not into
 *   the scene; `cloudUpsampling` (`'bilateral'`, `CLOUD_UPSAMPLINGS`): the way they are laid over
 *   the scene; `cloudRenderTargetScale` (1), read from 0.1 to 1: the target's size, of
 *   the quarter-to-full trace only; `cloudReprojectionBoxConstraint` (off): the reprojected image
 *   is held to its new neighbourhood; `cloudReprojectionMinDistanceKm` (0), from 0: the distance,
 *   in kilometres, a cloud surface must be at for the last image to be reprojected;
 *   `cloudDisocclusionMaxDistanceKm` (5), from 0: the distance past which the uncovered pixels
 *   are not rebuilt;
 * - `cloudFogLate` (on): the fog is applied to the clouds late in the frame, after they are rebuilt
 *   and enlarged, so it does not lag behind with them; about twice the cost of the enlarging pass.
 * - `cloudFogLateOnTranslucent` (off): with `cloudFogLate`, the translucent surfaces that wear
 *   `cloudFog` read the cloud image with the fog already laid on it, which the rebuild writes as
 *   one more image (about the cost of a pass over the rebuilt image and its memory); off, they read
 *   the image without the fog, as the fog is laid on it only when it is composed over the lit image;
 *   `cloudSoftBlendingDistanceOnTranslucent` (0.5), read from 0.0001: the kilometres, from the
 *   cloud's front, over which the cloud fades in over a translucent surface behind it.
 */
const EFFECTS_RULES = /* @__PURE__ */ (() => ({
  ...AIR_RULES,
  ...CLOUD_SAMPLING_RULES,
  ...CLOUD_SHADOW_RULES,
  ...CLOUD_TARGET_RULES,
}))()

/** The rules by the quality group whose levels write them. */
export const SKY_QUALITY_RULES_BY_GROUP = /* @__PURE__ */ (() =>
  ({
    effects: EFFECTS_RULES,
    imageEffects: IMAGE_EFFECTS_RULES,
    indirectLight: INDIRECT_LIGHT_RULES,
  }) as const)()

/** Every quality setting of the sky, by field. */
export const SKY_QUALITY_RULES = /* @__PURE__ */ (() => ({
  ...EFFECTS_RULES,
  ...IMAGE_EFFECTS_RULES,
  ...INDIRECT_LIGHT_RULES,
}))()
/** The field of one quality setting of the sky. */
export type SkyQualityField = keyof typeof SKY_QUALITY_RULES
/** The sky's quality settings as a host writes them, by their fields: each its value, or nothing
 *  for its default. */
export type SkyQualityOptions = SettingOptions<typeof SKY_QUALITY_RULES>
/** The sky's quality settings, resolved. */
export type SkyQualityValues = SettingValues<typeof SKY_QUALITY_RULES>
/** The sky's quality settings at their defaults: what a word given before the engine holds any live
 *  setting is resolved under (`resolveSky`); the frame follows it under the live ones each image
 *  (`skyAtQuality`). */
export const DEFAULT_SKY_QUALITY: SkyQualityValues = /* @__PURE__ */ resolveSettings(
  SKY_QUALITY_RULES,
  {},
)
