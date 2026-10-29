import { BOUNCE_MAX_LEVELS } from './contracts.ts'
import { nextPow2 } from '../../../math/src/scalar/integers.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import type { LightingDataFormat } from '../contracts/lightingDataFormatOptions.ts'
import {
  ANY_NUMBER,
  INT32_RANGE,
  choiceSetting as choice,
  countSetting as count,
  integerSetting as integer,
  flagSetting as flag,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  positiveSetting as positive,
  contextReader,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from '../contracts/settingRules.ts'

import {
  castsProbes,
  DEFAULT_SCREEN_PROBE_LEVEL,
  SCREEN_PROBE_CONSTANTS,
  SCREEN_PROBE_LEVEL_KNOBS,
  SCREEN_PROBE_LEVELS,
  type LevelKnobs,
  type ScreenProbeLevel,
} from './screenProbeLevels.ts'

/**
 * THE SCREEN PROBES: every image places a probe on each tile of its pixels, traces the screen and the
 * field of world probes from it, filters what it finds, and each pixel reads its indirect light from the
 * probes round it (`lighting/bounce/screen/`). The world probes (`./contracts.ts`) are the far field those
 * rays reach; the pixel no longer reads them. Run-time settings, as `../contracts/settingRules.ts` says:
 * read again at each image, never written in a manifest.
 *
 * LEVELS. `screenProbes` names one quality level of the indirect light (`SCREEN_PROBE_LEVELS`): `'off'`
 * lights nothing the probes do, `'high'`,
 * `'ultra'` (the default) and `'cinematic'` cast probes and each hold the values of their row of
 * `SCREEN_PROBE_LEVEL_KNOBS`; `true` is the default level and `false` `'off'`, as the temporal anti-aliasing's
 * level reads them (`resolveSetting`). The other settings are individual switches, each with its own default,
 * the reference's, in the units of the engine (metres).
 */

/** The furthest a ray looks for a surface by default, in metres (`screenProbeMaxTraceDistance`): the one distance the probes, the
 *  reflections and the lighting of the surface cache trace to, clamped to the range the rule allows, whatever the scene's size. */
export const MAX_TRACE_DISTANCE_METRES = 200

/** The trace tiles of the radiance cache: `half`, `full` or `supersampled` the resolution every probe's map is traced at, or `automatic`, the
 *  default: each tile of a probe's map is traced at the resolution the directions the screen probes want light from ask for (their cosine
 *  lobes' harmonics, summed into the probe), the whole side where no screen probe has made them. Whichever, a probe is traced at half the
 *  side past the downsample distance and, within the supersample distance, may be traced at twice it. */
const RADIANCE_TRACE_TILES = ['automatic', 'half', 'full', 'supersampled'] as const

/** The values of `radianceCacheIrradianceProbeOffsetMode`: the probes stay on their cell's centre, are moved off the surfaces the image shows, or off the surfaces of the global distance field. */
const PROBE_OFFSET_MODES = ['none', 'gbuffer', 'globalDistanceField'] as const

/** The most the gather's resolution is a multiple of the tracing's (`screenProbeGatherScale`), and the widest the gather is made: the conversion holds the harmonics' basis of the
 *  `gather × gather` texels of a probe in the workgroup's memory (nine floats a texel, with the light and the occlusion), 16 × 16 texels in about 15.4 kilobytes (9216 bytes of basis, 4096 of light, 2048 of occlusion), within the 16
 *  kilobytes every device grants, so the conversion's sums by subgroups, which hold more, are for a gather no finer than the tracing. */
const MAX_GATHER_SCALE = 4
const MAX_GATHER_SIDE = 16

/** The values of `screenProbeIrradianceFormat`: the level's row, or the format asked. */
const IRRADIANCE_FORMAT_CHOICES = ['level', 'sh3', 'octahedral'] as const

/** The smallest tile the probes are cut at, and the largest. */
const DOWNSAMPLE_RANGE = [4, 64] as const
/** The least and the most the occluders in front of a horizon weigh by (`screenProbeOcclusionForegroundPower`). */
const FOREGROUND_POWER_RANGE = [0.1, 10] as const

/** The ways the indirect light of the opaque surfaces is gathered (`finalGatherMethod`): by screen probes, the default, or by an irradiance field — the world's probes placed round the pixels, their irradiance
 *  and occlusion precomputed, interpolated to the pixels. */
const FINAL_GATHER_METHODS = ['screenProbes', 'irradianceField'] as const

/** A way of gathering the indirect light (`FINAL_GATHER_METHODS`). */
type FinalGatherMethod = (typeof FINAL_GATHER_METHODS)[number]

/** The irradiance field gather, resolved (`irradianceField*`; the world's probes are its cache, shaped by these, not by the level's row). */
export interface IrradianceFieldSettings {
  /** The levels of probes, the extent of the first in metres and the base each next one's grows by. */
  clipmaps: number
  worldExtent: number
  distributionBase: number
  /** The probes traced an image, in the cost of a whole map each. */
  budget: number
  /** The cells a side of a level, the texels a side of a probe's radiance map, of its irradiance map and of its occlusion map, and the levels of detail of the radiance. */
  gridResolution: number
  probeResolution: number
  irradianceResolution: number
  occlusionResolution: number
  mipmaps: number
  /** The probes along a side of the atlas that holds them. */
  atlasProbes: number
  /** The bias off the surface, along its normal and toward the eye, the occlusion of a probe is read at, in metres. */
  occlusionBias: number
  /** The radius of the short-range occlusion the field gathers with, in pixels. */
  shortRangeRadius: number
  /** The reductions the pixels' interpolation runs at and the probes' marks are made at (on top of it). */
  interpolateDownsample: number
  markDownsample: number
  /** Whether probes are placed where an interpolation fails for want of one, and the tile of pixels one of which reports those failures. */
  adaptivePlacement: boolean
  feedbackTile: number
  /** How the probes standing too near a surface are moved off it before they are traced (`radianceCacheIrradianceProbeOffsetMode`). */
  probeOffsetMode: (typeof PROBE_OFFSET_MODES)[number]
  /** The roughness past which a pixel's rough specular is its diffuse light. */
  maxRoughnessToEvaluateRoughSpecular: number
}

/** The octahedron's resolutions a probe may trace. */
const TRACING_RANGE = [4, 16] as const

/** The most levels of detail the probes' filtered radiance holds (`screenProbeGatherNumMips`): the border of the finest level is `2 ** levels` texels,
 *  and a probe's square of texels, the widest gather over the tracing's range plus that border, must fit the 8192 texels a texture measures
 *  on any WebGPU device (`maxTextureDimension2D`'s default). The constant bounds the option; the device bounds the view: a device
 *  whose own `maxTextureDimension2D` is smaller doubles the probes' tile, and refuses the view when the atlas still does not fit (`atlasFits`,
 *  in the screen probes' layout). The floor of log2(8192 − 16), the widest tracing, written out so that no bundle runs it. */
const MAX_GATHER_MIPS = 12

/** The values of `screenProbeDiffuseIntegralMethod`: the probes' preintegrated irradiance, the pixel's BRDF sampled over the probes' radiance, and the numerical
 *  integral over every texel of the probes it reads (which has no tile classification). */
export const DIFFUSE_INTEGRAL_METHOD = { preintegrated: 0, sampled: 1, numerical: 2 } as const

/** What the reference mode (`screenProbeReferenceMode`) takes of the other settings, whatever they say: no importance sampling, no spatial filter, no
 *  probe filtering in time, no radiance cache, no short-range occlusion, and every pixel integrated numerically. */
const REFERENCE_MODE_VALUES = {
  screenProbeImportanceSampling: false,
  screenProbeSpatialFilter: false,
  screenProbeTemporalFilterProbes: false,
  screenProbeRadianceCache: false,
  screenProbeShortRangeOcclusion: false,
  // The numerical integral, a literal held to its name by the type: a property read of the table is code a bundle that reads no setting cannot drop.
  screenProbeDiffuseIntegralMethod: 2 satisfies typeof DIFFUSE_INTEGRAL_METHOD.numerical,
} as const

/** The sides the reference mode fixes: the tile, the rays along a probe's side and the gather's texels. 32 rays along a side is a workgroup of 1024 threads a
 *  probe: a device that grants that many invocations (`maxComputeInvocationsPerWorkgroup`, which the session asks for at the adapter's) runs it; on another the kernels do
 *  not compile and the probes are refused with the reason (`ScreenProbeStore.reason`). */
const REFERENCE_MODE_SIDES = { downsample: 16, tracing: 32, gather: 8 } as const

/** The level, the probes, their filtering, their history and the short-range occlusion. */
const PLACEMENT_AND_OCCLUSION_RULES = /* @__PURE__ */ (() =>
  [
    choice('screenProbes', DEFAULT_SCREEN_PROBE_LEVEL, SCREEN_PROBE_LEVELS),
    positive('screenProbeQuality', 1),
    positive('screenProbeUpdateSpeed', 1),
    nonNegative('screenProbeAdaptiveFraction', SCREEN_PROBE_CONSTANTS.adaptiveFractionDefault),
    number('screenProbeGatherScale', 1, [0.1, MAX_GATHER_SCALE]),
    flag('screenProbeScreenTraces', true),
    flag('screenProbeImportanceSampling', true),
    flag('screenProbeSpatialFilter', true),
    count('screenProbeSpatialFilterPasses', 3, 0),
    count('screenProbeSpatialFilterKernel', 1, 0),
    positive('screenProbeMaxRayIntensity', 10),
    flag('screenProbeTemporal', true),
    flag('screenProbeClearHistoryEveryFrame', false),
    flag('screenProbeReferenceMode', false),
    flag('screenProbeDebugForceTracesMoving', false),
    flag('screenProbeGatherDebug', false),
    flag('screenProbeTileDebugMode', false),
    integer('screenProbeGatherDebugProbePlacement', 0, [0, 3]),
    flag('screenProbeGatherVisualizeTraces', false),
    flag('screenProbeGatherVisualizeTracesFreeze', false),
    flag('visualizeUseShaderPrintForTraces', true),
    flag('visualizeToneMap', true),
    flag('reflectionVisualizeTraces', false),
    integer('radianceCacheVisualize', 0, [0, 2]),
    number('radianceCacheVisualizeRadiusScale', 1, [0, 100]),
    integer('radianceCacheVisualizeClipmapIndex', -1, [-1, BOUNCE_MAX_LEVELS - 1]),
    integer('debugCursorX', -1, [-1, 16384]),
    integer('debugCursorY', -1, [-1, 16384]),
    // These name the level's row by a negative value (`namedOr`): the reference's cvars of the same names, its scalability rows being the levels.
    integer('screenProbeDownsampleFactor', -1, [-1, DOWNSAMPLE_RANGE[1]]),
    integer('screenProbeTracingResolution', -1, [-1, TRACING_RANGE[1]]),
    integer('screenProbeNumAdaptiveProbes', -1, [-1, 64]),
    number('screenProbeFullResolutionJitterWidth', -1, ANY_NUMBER),
    integer('screenProbeOcclusionSlices', -1, [-1, 16]),
    number('screenProbeOcclusionForegroundPower', -1, [-1, 10]),
    integer('screenProbeOcclusionPyramid', -1, [-1, 1]),
    choice('screenProbeIrradianceFormat', 'level', IRRADIANCE_FORMAT_CHOICES),
    count('screenProbeMaxFramesAccumulated', SCREEN_PROBE_CONSTANTS.maxFramesAccumulated, 1),
    count('screenProbeMaxRayDirections', SCREEN_PROBE_CONSTANTS.rayDirections, 1),
    flag('screenProbeTemporalFilterProbes', false),
    number('screenProbeTemporalFilterProbesHistoryWeight', 0.5, ANY_NUMBER),
    flag('screenProbeExtraAmbientOcclusion', false),
    number('screenProbeExtraAmbientOcclusionMaxDistance', 5, [0.000001, 10000]),
    number('screenProbeExtraAmbientOcclusionExponent', 0.5, [0.01, 100]),
    integer('screenProbeGatherNumMips', 1, [1, MAX_GATHER_MIPS]),
    flag('screenProbeMaterialAO', true),
    flag('screenProbeShortRangeOcclusion', true),
    number('screenProbeOcclusionIntensity', 1, [0, 1]),
    flag('screenProbeOcclusionTemporal', true),
    flag('screenProbeBentNormal', true),
    flag('screenProbeOcclusionVisibilityBitmask', false),
    flag('screenProbeOcclusionHorizonSearch', true),
    flag('screenProbeShortRangeGI', false),
    number('screenProbeShortRangeGIMaxScreenFraction', 0.1, ANY_NUMBER),
    positive('screenProbeShortRangeGIMaxRayIntensity', 5),
    positive('screenProbeShortRangeGIHistoryDepthTestRelativeThickness', 0.0005),
    nonNegative('screenProbeOcclusionSlopeCompareToleranceScale', 0.5),
    count('screenProbeOcclusionSteps', 3, 1),
    nonNegative('screenProbeOcclusionForegroundFraction', 0.3),
    nonNegative('screenProbeOcclusionMaxAlbedo', 0.5),
    number('screenProbeOcclusionClampScale', 1, ANY_NUMBER),
    number('screenProbeOcclusionFoliageStrength', -1, [-1, 1]),
    flag('screenProbeShortRangeAOApplyDuringIntegration', false),
    integer('screenProbeShortRangeAODownsampleFactor', -1, [-1, 2]),
    integer('screenProbeIntegrateDownsampleFactor', 1, [1, 2]),
    flag('screenProbeIntegrationTileClassification', true),
    count('screenProbeScreenTracesMinimumOccupancy', 0, 0),
    flag('screenProbeScreenTracesHZBTraversal', true),
    flag('screenProbeFilteringWaveOps', true),
    integer('screenProbeDiffuseIntegralMethod', 0, [0, 2]),
  ] as const)()

/** The scene traces, the history thresholds, the screen trace and the radiance cache. */
const TRACE_AND_CACHE_RULES = /* @__PURE__ */ (() =>
  [
    flag('screenProbeSceneTraces', true),
    number('screenProbeMaxTraceDistance', MAX_TRACE_DISTANCE_METRES, [0.0001, 10485.76]),
    number('screenProbeSurfaceBias', 0.05, [0.0001, 1]),
    number('screenProbeMinTraceDistance', 0.0001, [0.0001, 10]),
    number('screenProbeInterpolationDepthWeight', 1, ANY_NUMBER),
    number('screenProbeInterpolationDepthWeightForFoliage', 0.25, ANY_NUMBER),
    number('screenProbeInterpolationDepthWeightFallback', 0.1, ANY_NUMBER),
    positive('screenProbeHistoryDistanceThreshold', 0.01),
    positive('screenProbeHistoryDistanceThresholdForFoliage', 0.03),
    flag('screenProbeRejectBasedOnNormal', false),
    number('screenProbeNormalThreshold', 45, [0, 180]),
    positive('screenProbeRelativeSpeedThreshold', 0.005),
    positive('screenProbeFastUpdateFraction', 0.1),
    number('screenProbeMaxFastUpdate', 0.9, [0, 1]),
    flag('screenProbeFastUpdateClamp', false),
    flag('screenProbeImportanceIncomingLighting', true),
    flag('screenProbeProbeRadianceHistory', true),
    number('screenProbeMinPdfToTrace', 0.1, [0, 1]),
    nonNegative('screenProbeSpatialFilterPositionWeightScale', 1000),
    number('screenProbeSpatialFilterMaxHitAngle', 10, [0.01, 180]),
    count('screenProbeDisocclusionMaxFrames', 4, 0),
    number('screenProbeDisocclusionFraction', 0.4, [0, 1]),
    positive('screenProbeHistoryDepthTestThickness', 0.005),
    positive('screenProbeRelativeDepthThickness', 0.02),
    count('screenProbeMaxIterations', 50, 0),
    flag('screenProbeRadianceCache', true),
    flag('screenProbeRadianceCacheUpdate', true),
    flag('screenProbeRadianceCacheForceFullUpdate', false),
    flag('screenProbeRadianceCacheStats', false),
    nonNegative('screenProbeRadianceCacheReprojectionRadiusScale', 1.5),
    count('screenProbeRadianceCacheFramesToKeepProbes', 8, 0),
    integer('screenProbeRadianceCacheTemporaryAtlasDownsampleFactor', 6, [1, 1024]),
    integer('screenProbeMarkDownsampleFactor', 2, [1, 8]),
    integer('screenProbeInterpolateDownsampleFactor', 2, [1, 2]),
  ] as const)()

/** The radiance cache's settings. */
const RADIANCE_CACHE_RULES = /* @__PURE__ */ (() =>
  [
    flag('screenProbeTranslucencyReflectionsRadianceCache', true),
    integer('screenProbeTranslucencyReflectionsMarkDownsampleFactor', 4, [1, 64]),
    flag('screenProbeTranslucencyReflectionsHizOcclusionTest', true),
    number('screenProbeTranslucencyReflectionsClipmapFadeSize', 4, [0.001, 16]),
    flag('screenProbeRadianceCacheSpatialFilter', true),
    flag('screenProbeRadianceCacheSortTraceTiles', false),
    positive('screenProbeRadianceCacheFilterHitAngle', 0.2, 'a finite number of radians above 0'),
    choice('screenProbeRadianceCacheTraceTiles', 'automatic', RADIANCE_TRACE_TILES),
    nonNegative('screenProbeRadianceCacheSupersampleTileBrdfThreshold', 0.1),
    nonNegative('screenProbeRadianceCacheDownsampleDistance', 40),
    number('screenProbeRadianceCacheSupersampleDistance', -1, ANY_NUMBER),
    integer('screenProbeRadianceCacheMipmaps', 1, [1, 3]),
    flag('screenProbeRadianceCacheSkyVisibility', false),
    flag('screenProbeRadianceCacheHardwareRayTracing', true),
    nonNegative('hardwareRayTracingPullbackBias', 0.08),
    flag('screenProbeHardwareRayTracing', true),
    nonNegative('screenProbeHardwareRayTracingBias', 0.001),
    nonNegative('screenProbeHardwareRayTracingNormalBias', 0.001),
    nonNegative('screenProbeHardwareRayTracingHairBias', 0.02),
    flag('screenProbeSkipFoliageHits', true),
    flag('screenProbeSkipHairHits', false),
    flag('screenProbeSkipUnlitHits', false),
    nonNegative('screenProbeScreenTracesHairBias', 0.02),
    positive('screenProbeThicknessScaleWithoutField', 2),
    integer('screenProbeThicknessCertaintySteps', 4, [0, 64]),
    flag('screenProbeTwoSidedFoliageBackfaceDiffuse', true),
    number('screenProbeSkylightLeakingRoughness', 0.3, ANY_NUMBER),
    number('screenProbeFullSkylightLeakingDistance', 10, [0.001, 10485.76]),
    flag('screenProbeHeightFogOnGI', false),
    number('screenProbeMaxRoughnessToEvaluateRoughSpecular', 0.8, ANY_NUMBER),
    number('screenProbeMaxRoughnessToEvaluateRoughSpecularForFoliage', -1, ANY_NUMBER),
    integer('screenProbeFixedJitterIndex', -1, [-1, INT32_RANGE[1]]),
    integer('screenProbeFixedStateFrameIndex', -1, [-1, INT32_RANGE[1]]),
    integer('stochasticLightingFixedStateFrameIndex', -1, [-1, INT32_RANGE[1]]),
  ] as const)()

/** The irradiance field gather's settings. */
const IRRADIANCE_FIELD_RULES = /* @__PURE__ */ (() =>
  [
    // The irradiance field gather (`finalGatherMethod` 'irradianceField'): the reference's `r.Lumen.IrradianceFieldGather.*`, distances in metres where it has centimetres.
    choice('finalGatherMethod', 'screenProbes', FINAL_GATHER_METHODS),
    integer('irradianceFieldNumClipmaps', 4, [1, BOUNCE_MAX_LEVELS]),
    number('irradianceFieldClipmapWorldExtent', 50, [0.01, 1e6]),
    number('irradianceFieldClipmapDistributionBase', 2, [1, 16]),
    count('irradianceFieldNumProbesToTraceBudget', 100, 0),
    integer('irradianceFieldGridResolution', 64, [1, 256]),
    integer('irradianceFieldProbeResolution', 16, [8, 64]),
    integer('irradianceFieldIrradianceProbeResolution', 6, [1, 32]),
    integer('irradianceFieldOcclusionProbeResolution', 16, [1, 64]),
    integer('irradianceFieldNumMipmaps', 3, [1, 3]),
    integer('irradianceFieldProbeAtlasResolutionInProbes', 128, [1, 255]),
    number('irradianceFieldProbeOcclusionBias', 0.008, [0, 100]),
    number('irradianceFieldShortRangeAORadius', 32, [0, 4096]),
    integer('irradianceFieldInterpolateDownsampleFactor', 2, [1, 2]),
    integer('irradianceFieldMarkProbesDownsampleFactor', 2, [1, 8]),
    flag('irradianceFieldAdaptivePlacement', false),
    integer('irradianceFieldAdaptivePlacementFeedbackTileSize', 8, [1, 256]),
    choice('radianceCacheIrradianceProbeOffsetMode', 'gbuffer', PROBE_OFFSET_MODES),
    number('irradianceFieldMaxRoughnessToEvaluateRoughSpecular', 0.8, ANY_NUMBER),
  ] as const)()

/** The screen probes' settings by field, each with its default; `'ultra'` the level. */
export const SCREEN_PROBE_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    ...PLACEMENT_AND_OCCLUSION_RULES,
    ...TRACE_AND_CACHE_RULES,
    ...RADIANCE_CACHE_RULES,
    ...IRRADIANCE_FIELD_RULES,
  ] as const))()
/** The screen probes setting `field` of a runtime's context (`contextReader`): its default where the
 *  context holds none. */
export const readScreenProbeSetting = /* @__PURE__ */ contextReader(SCREEN_PROBE_RULES)
/** Whether the short-range occlusion switch is on in a runtime's context, as the probes resolve it: the reference mode (`screenProbeReferenceMode`) turns it off. */
export const readShortRangeOcclusion = (context: Parameters<typeof readScreenProbeSetting>[0]) =>
  readScreenProbeSetting(context, 'screenProbeShortRangeOcclusion') &&
  !readScreenProbeSetting(context, 'screenProbeReferenceMode')
/** The field of one setting of the screen probes. */
export type ScreenProbeField = keyof typeof SCREEN_PROBE_RULES
/** The screen probes' settings as a host writes them, by their fields: each its value, or nothing for its
 *  default. */
export type ScreenProbeOptions = SettingOptions<typeof SCREEN_PROBE_RULES>

/** The values of every setting, resolved (`resolveSettings`). */
export type ScreenProbeValues = SettingValues<typeof SCREEN_PROBE_RULES>

/** What a view's screen probes are: the values of the settings (`values`, read by their own names) and what the level and the
 *  settings make together (`resolveScreenProbes`) — the level's row, scaled where a setting scales it. */
export type ScreenProbeSettings = LevelKnobs & {
  values: ScreenProbeValues
  /** The level the settings were resolved at. */
  level: ScreenProbeLevel
  /** Whether the view draws the level at all: false at the level `'off'`. */
  enabled: boolean
  /** Rays along a side of a probe's octahedron the filter and the integration work at (`screenProbeGatherScale` of the tracing resolution). */
  gatherResolution: number
  /** The passes of the spatial filter: none where it is off or its kernel is. */
  spatialFilterPasses: number
  /** The frames a pixel's history holds at most, scaled by the update speed. */
  maxFramesAccumulated: number
  /** Whether the short-range occlusion is searched and applied. */
  occlusion: boolean
  /** The reduction the integration of the probes runs at (`screenProbeIntegrateDownsampleFactor`), 1 or 2: the pixels of the image over a texel of it. */
  integrateDownsample: number
  /** How a pixel's diffuse light is integrated from the probes (`screenProbeDiffuseIntegralMethod`, `DIFFUSE_INTEGRAL_METHOD`): the probes' preintegrated irradiance, the pixel's BRDF
   *  sampled over the probes' radiance, the numerical integral over every texel of the probes (the slow reference); the first at the level off. */
  integralMethod: number
  /** Whether the integration is dispatched over the lists of tiles of its three modes (`screenProbeIntegrationTileClassification`), with an integral
   *  method that is not the numerical one: else it is dispatched over every pixel at once. */
  tileClassification: boolean
  /** Whether the occlusion keeps its bent normal: the switch over a level that allows it, with the occlusion searched. */
  bentNormal: boolean
  /** The rays a pixel casts for its short-range occlusion where the horizon search is off (`screenProbeOcclusionHorizonSearch`), none else. */
  occlusionRays: number
  /** The way the indirect light is gathered, and, for the irradiance field, its shape (`irradianceField*`): the cache of probes round the pixels, the maps of each probe, and how the pixels read them. */
  finalGather: FinalGatherMethod
  irradianceField: IrradianceFieldSettings
  /** Whether the short-range occlusion also gathers the light the near surfaces of the last image give a pixel (`screenProbeShortRangeGI`), which only the horizon search finds. */
  shortRangeGi: boolean
  /** Whether the pixels of a thin double-sided sheet gather the light along their backface: the switch over a level that allows it. */
  backfaceDiffuse: boolean
  /** Whether the far light comes from the radiance cache: the switch. */
  radianceCache: boolean
  /** What the radiance cache — a map of the light by direction in every probe of the world's pool — is made of: the settings
   *  the world's probes trace it by. */
  cache: RadianceCacheSettings
  /** The inverse of the share of a pixel's light that must move for its history to give way. */
  fastUpdateInverseFraction: number
  /** Whether the rays' directions follow the light (the importance sampling's second half). */
  importanceLighting: boolean
  /** The linear steps along the ray past a hit that look for a thin feature (0 while foliage hits are skipped). */
  thicknessCertaintySteps: number
  /** Whether a probe's composited radiance is blended with the last image's (`screenProbeTemporalFilterProbes`). */
  temporalFilterProbes: boolean
  /** Whether the probes keep an ambient occlusion of their own beside their radiance (`screenProbeExtraAmbientOcclusion`). */
  extraAo: boolean
  /** The levels of detail of the probes' filtered radiance (`screenProbeGatherNumMips`): each level halves the side, border included, which is the
   *  gather's plus two to the power of the levels. */
  gatherMips: number
}

/** Whether the short-range occlusion is searched and applied: its switch is on and its strength is above zero. */
const searchesOcclusion = (switchedOn: boolean, intensity: number) => switchedOn && intensity > 0

/** How the translucent surfaces mark the cells of the radiance cache they read (`translucentMarkOf`): their meshes drawn at the view's size
 *  divided by `downsample`, a fragment hidden by the farthest depth of the opaque surfaces' pyramid (read at its level `hizMip`) marking nothing
 *  where `hizTest`, the others marking their point with a level's share of the answer fading over `1 / invFade` probes at its edge. */
export interface TranslucentMarkSettings {
  downsample: number
  hizMip: number
  hizTest: boolean
  invFade: number
}

/** The radiance cache's settings, resolved (`resolveScreenProbes`; the translucency volume's cache has its own, `translucencyCacheSettings`). */
interface RadianceCacheSettings {
  /** Texels along a side of a probe's map. */
  resolution: number
  /** Probes traced an image, in the cost of a whole map each, the update speed taken in (`screenProbeUpdateSpeed`, held to
   *  `BUDGET_SPEED_RANGE`). */
  budget: number
  /** The factor the probes' atlas is divided by for the temporary atlas the probes one image updates are traced into: it names the probes
   *  an image may queue (`probeQueueFor`). */
  temporaryAtlasDownsample: number
  /** How a probe's map is cut into the tiles that are traced (`RADIANCE_TRACE_TILES`). */
  tiles: (typeof RADIANCE_TRACE_TILES)[number]
  /** The frames a world probe nothing reads is kept before it is given back. */
  framesToKeepProbes: number
  /** Where the last image cast no screen probe, the cells it reads are marked from the image downsampled by `interpolateDownsample`
   *  (the factor the pixels would be interpolated at) and then by `markDownsample`. */
  markDownsample: number
  interpolateDownsample: number
  /** The translucent surfaces' own mark of the cells they read, none where `screenProbeTranslucencyReflectionsRadianceCache` is off. */
  translucentMark: TranslucentMarkSettings | undefined
  /** Whether the trace tiles are ordered by the direction they trace before they are traced (`screenProbeRadianceCacheSortTraceTiles`). */
  sortTiles: boolean
  /** The value of the screen probes' lobes above which a tile of a probe's map is traced at twice the resolution (`screenProbeRadianceCacheSupersampleTileBrdfThreshold`). */
  tileThreshold: number
  /** Whether a probe's map is averaged with its neighbours', and the angle that weighs them, in radians. */
  filter: boolean
  filterAngle: number
  /** The squares of the distances, in metres, past which a probe is traced at half its side, and within which it may be traced at
   *  twice it. */
  downsampleSq: number
  supersampleSq: number
  /** The levels of detail of the final maps (a cone wider than a texel reads a coarser one), and whether the sky is kept apart from
   *  the light, as the share of a ray that left the scene, to be read from the sky itself. */
  mipmaps: number
  skyVisibility: boolean
  /** The format the maps' light is stored at (`lightingDataFormat`, the one setting every family that keeps light shares). */
  light: LightingDataFormat
  /** The scale of the nearest a probe's ray starts at, over its cell's diagonal. */
  minTraceScale: number
  /** Whether the cache makes irradiance maps beside its radiance (the irradiance field's: `CalculateIrradiance`), which adds the sky light's leaking to the rays cast through the scene's triangles
   *  (`SkylightLeaking`, `RadianceCacheHardwareRayTracing.cpp:543`). */
  calculatesIrradiance: boolean
  /** The roughness the leaking sky light is read at (`screenProbeSkylightLeakingRoughness`), the inverse of the distance it leaks whole at, per metre, and its share by channel, the view's (the image
   *  writes it before the cache reads it: zero until then). */
  skylightLeakingRoughness: number
  skylightLeakingInverseDistance: number
  skylightLeak: [number, number, number]
}

/** The scales of the update speed the radiance cache's budget takes in: the speed is held between them. */
const BUDGET_SPEED_RANGE = [0.5, 4] as const

/** The translucent surfaces' mark, from the settings: the pyramid level its depth test reads is one under the log2 of the downsample (none under the
 *  first), the fade over `invFade`, the inverse of the fade size in probes (the translucency volume's marks alone, which no fragment fades, take one). */
export function translucentMarkSettings(
  values: ScreenProbeValues,
  invFade: number,
): TranslucentMarkSettings {
  const downsample = values.screenProbeTranslucencyReflectionsMarkDownsampleFactor
  return {
    downsample,
    // The pyramid's level 0 is the full image (the reference's first level is half of it): one level further than the reference names.
    hizMip: Math.max(Math.floor(Math.log2(downsample)), 1),
    hizTest: values.screenProbeTranslucencyReflectionsHizOcclusionTest,
    invFade,
  }
}

/** The translucent surfaces' mark of the radiance cache, none where they do not mark it. */
const translucentMarkOf = (values: ScreenProbeValues) =>
  values.screenProbeTranslucencyReflectionsRadianceCache
    ? translucentMarkSettings(values, 1 / values.screenProbeTranslucencyReflectionsClipmapFadeSize)
    : undefined

/** The radiance cache's settings of a view's screen probes, from the settings and the level's row. */
function resolveRadianceCache(
  values: ScreenProbeValues,
  rows: LevelKnobs,
  light: LightingDataFormat,
): RadianceCacheSettings {
  return {
    resolution: rows.radianceProbeResolution,
    budget: Math.round(
      rows.radianceProbeBudget * clamp(values.screenProbeUpdateSpeed, ...BUDGET_SPEED_RANGE),
    ),
    tiles: values.screenProbeRadianceCacheTraceTiles,
    framesToKeepProbes: values.screenProbeRadianceCacheFramesToKeepProbes,
    temporaryAtlasDownsample: values.screenProbeRadianceCacheTemporaryAtlasDownsampleFactor,
    markDownsample: values.screenProbeMarkDownsampleFactor,
    interpolateDownsample: values.screenProbeInterpolateDownsampleFactor,
    translucentMark: translucentMarkOf(values),
    sortTiles: values.screenProbeRadianceCacheSortTraceTiles,
    tileThreshold: values.screenProbeRadianceCacheSupersampleTileBrdfThreshold,
    filter: values.screenProbeRadianceCacheSpatialFilter,
    filterAngle: values.screenProbeRadianceCacheFilterHitAngle,
    downsampleSq: values.screenProbeRadianceCacheDownsampleDistance ** 2,
    supersampleSq: Math.max(values.screenProbeRadianceCacheSupersampleDistance, 0) ** 2,
    mipmaps: values.screenProbeRadianceCacheMipmaps,
    skyVisibility: values.screenProbeRadianceCacheSkyVisibility,
    light,
    minTraceScale: SCREEN_PROBE_CONSTANTS.radianceProbeMinTraceScale,
    calculatesIrradiance: false,
    skylightLeakingRoughness: values.screenProbeSkylightLeakingRoughness,
    skylightLeakingInverseDistance:
      1 /
      Math.min(values.screenProbeFullSkylightLeakingDistance, values.screenProbeMaxTraceDistance),
    skylightLeak: [0, 0, 0],
  }
}

/** A setting that names the level's row by a negative value: its value where it is one, else the row's. */
const namedOr = (asked: number, row: number) => (asked < 0 ? row : asked)

/** The reduction the short-range occlusion is searched at, as asked: the setting's, from 1 to 2, else the level's row (the level's value of the setting). */
const requestedOcclusionDownsample = (values: ScreenProbeValues, level: number) => {
  const asked = values.screenProbeShortRangeAODownsampleFactor
  return asked < 0 ? level : clamp(asked, 1, 2)
}

/** The reduction the integration is asked to run at (`screenProbeIntegrateDownsampleFactor`), from 1 to 2; 1 where its tiles are not classified
 *  (`screenProbeIntegrationTileClassification`). */
const requestedIntegrateDownsample = (values: ScreenProbeValues) =>
  values.screenProbeIntegrationTileClassification
    ? clamp(values.screenProbeIntegrateDownsampleFactor, 1, 2)
    : 1

/** The reduction the short-range occlusion is searched at: the one asked, else 1 where the occlusion is applied during the integration and
 *  the integration is not asked to run at that same reduction (the integration then reads the occlusion texel of its own pixel), or where it
 *  has no temporal pass to filter the fewer texels. */
function occlusionDownsampleOf(values: ScreenProbeValues, level: number) {
  const requested = requestedOcclusionDownsample(values, level)
  if (values.screenProbeShortRangeAOApplyDuringIntegration)
    return requested === requestedIntegrateDownsample(values) ? requested : 1
  return values.screenProbeOcclusionTemporal ? requested : 1
}

/** The reduction the integration of the probes runs at: a pixel in this many along each side of the image, the others rebuilt by the temporal
 *  pass from the four texels round them. The one asked, else 1 where the level is off, or where the occlusion is searched and applied during
 *  the integration at another reduction. */
function integrateDownsampleOf(
  values: ScreenProbeValues,
  level: number,
  casts: boolean,
  occlusion: boolean,
) {
  const requested = requestedIntegrateDownsample(values)
  if (
    !casts ||
    (occlusion &&
      values.screenProbeShortRangeAOApplyDuringIntegration &&
      requestedOcclusionDownsample(values, level) !== requested)
  )
    return 1
  return requested
}

/** The level's row, but for the values the settings name (a negative one names the row's). */
function namedKnobs(values: ScreenProbeValues, row: LevelKnobs): LevelKnobs {
  return {
    ...row,
    downsampleFactor: namedOr(values.screenProbeDownsampleFactor, row.downsampleFactor),
    tracingResolution: namedOr(values.screenProbeTracingResolution, row.tracingResolution),
    adaptiveProbes: namedOr(values.screenProbeNumAdaptiveProbes, row.adaptiveProbes),
    jitterWidth: namedOr(values.screenProbeFullResolutionJitterWidth, row.jitterWidth),
    occlusionSlices:
      values.screenProbeOcclusionSlices < 1
        ? row.occlusionSlices
        : values.screenProbeOcclusionSlices,
    occlusionForegroundPower:
      values.screenProbeOcclusionForegroundPower < 0
        ? row.occlusionForegroundPower
        : clamp(values.screenProbeOcclusionForegroundPower, ...FOREGROUND_POWER_RANGE),
    occlusionPyramid: namedOr(values.screenProbeOcclusionPyramid, +row.occlusionPyramid) > 0,
  }
}

/** A scale from one up multiplies the tracing's resolution by the whole number nearest it (held to `MAX_GATHER_SIDE`), under one it divides it by the one nearest its inverse. */
const gatherResolutionOf = (scale: number, tracingResolution: number) =>
  scale >= 1
    ? Math.min(tracingResolution * Math.round(scale), MAX_GATHER_SIDE)
    : Math.max(1, Math.trunc(tracingResolution / Math.round(1 / Math.max(scale, 0.1))))

/** The irradiance field's numbers from the settings. */
function irradianceFieldOf(values: ScreenProbeValues): IrradianceFieldSettings {
  return {
    clipmaps: values.irradianceFieldNumClipmaps,
    worldExtent: values.irradianceFieldClipmapWorldExtent,
    distributionBase: values.irradianceFieldClipmapDistributionBase,
    budget: values.irradianceFieldNumProbesToTraceBudget,
    gridResolution: values.irradianceFieldGridResolution,
    probeResolution: values.irradianceFieldProbeResolution,
    irradianceResolution: values.irradianceFieldIrradianceProbeResolution,
    occlusionResolution: values.irradianceFieldOcclusionProbeResolution,
    mipmaps: values.irradianceFieldNumMipmaps,
    atlasProbes: values.irradianceFieldProbeAtlasResolutionInProbes,
    occlusionBias: values.irradianceFieldProbeOcclusionBias,
    shortRangeRadius: values.irradianceFieldShortRangeAORadius,
    interpolateDownsample: values.irradianceFieldInterpolateDownsampleFactor,
    markDownsample: values.irradianceFieldMarkProbesDownsampleFactor,
    adaptivePlacement: values.irradianceFieldAdaptivePlacement,
    feedbackTile: values.irradianceFieldAdaptivePlacementFeedbackTileSize,
    probeOffsetMode: values.radianceCacheIrradianceProbeOffsetMode,
    maxRoughnessToEvaluateRoughSpecular: values.irradianceFieldMaxRoughnessToEvaluateRoughSpecular,
  }
}

/** The rays the occlusion casts without the horizon search: four, eight from a quality of 2, sixteen from 6. */
const occlusionRaysOf = (values: ScreenProbeValues) =>
  values.screenProbeOcclusionHorizonSearch
    ? 0
    : values.screenProbeQuality >= 6
      ? 16
      : values.screenProbeQuality >= 2
        ? 8
        : 4

/** The settings' switches and numbers that are read off the values alone (the level's row, whether the level casts and the occlusion is searched). */
function switchesOf(
  values: ScreenProbeValues,
  knobs: LevelKnobs,
  casts: boolean,
  occlusion: boolean,
) {
  return {
    integralMethod: casts
      ? values.screenProbeDiffuseIntegralMethod
      : DIFFUSE_INTEGRAL_METHOD.preintegrated,
    tileClassification:
      casts &&
      values.screenProbeIntegrationTileClassification &&
      values.screenProbeDiffuseIntegralMethod !== DIFFUSE_INTEGRAL_METHOD.numerical,
    shortRangeGi:
      values.screenProbeShortRangeGI &&
      values.screenProbeOcclusionHorizonSearch &&
      !values.screenProbeOcclusionVisibilityBitmask &&
      occlusion,
    occlusionRays: occlusionRaysOf(values),
    occlusionFoliageStrength: namedOr(
      values.screenProbeOcclusionFoliageStrength,
      knobs.occlusionFoliageStrength,
    ),
    backfaceDiffuse: values.screenProbeTwoSidedFoliageBackfaceDiffuse && knobs.backfaceDiffuse,
    fastUpdateInverseFraction: 1 / Math.max(values.screenProbeFastUpdateFraction, 0.001),
    importanceLighting:
      values.screenProbeImportanceSampling && values.screenProbeImportanceIncomingLighting,
    thicknessCertaintySteps: values.screenProbeSkipFoliageHits
      ? 0
      : values.screenProbeThicknessCertaintySteps,
    temporalFilterProbes: casts && values.screenProbeTemporalFilterProbes,
    extraAo: casts && values.screenProbeExtraAmbientOcclusion,
    gatherMips: casts ? values.screenProbeGatherNumMips : 1,
  }
}

/**
 * The numbers a view's screen probes run on, from its settings: the level's values, the quality's scales
 * (rays along a side the power of two over the truncated `√quality · tracingResolution`, four to sixteen; the tile
 * halved from a quality of six), the update speed's (the history's frames over `√clamp(speed, ½, 8)`), the gather
 * resolution (the tracing one over the whole number nearest the inverse of the gather scale), and the individual
 * switches. A tile is never under four pixels nor over sixty-four.
 */
export function resolveScreenProbes(
  asked: ScreenProbeValues,
  light: LightingDataFormat = 'r11g11b10',
): ScreenProbeSettings {
  const reference = asked.screenProbeReferenceMode
  const values = reference ? { ...asked, ...REFERENCE_MODE_VALUES } : asked
  const level = values.screenProbes
  const casts = castsProbes(level)
  // The level `'off'` runs no probe: its row is the default level's, which nothing reads.
  const row: LevelKnobs = SCREEN_PROBE_LEVEL_KNOBS[casts ? level : DEFAULT_SCREEN_PROBE_LEVEL]
  const knobs = namedKnobs(values, row)
  const quality = values.screenProbeQuality
  const rows = SCREEN_PROBE_LEVEL_KNOBS[casts ? level : 'high']
  const tracingResolution = clamp(
    nextPow2(Math.trunc(Math.sqrt(quality) * knobs.tracingResolution)),
    ...TRACING_RANGE,
  )
  const speed = 1 / Math.sqrt(clamp(values.screenProbeUpdateSpeed, 0.5, 8))
  const gatherResolution = gatherResolutionOf(values.screenProbeGatherScale, tracingResolution)
  const occlusion = searchesOcclusion(
    values.screenProbeShortRangeOcclusion,
    values.screenProbeOcclusionIntensity,
  )
  const format =
    values.screenProbeIrradianceFormat === 'level'
      ? knobs.irradianceFormat
      : values.screenProbeIrradianceFormat
  const bentNormal = values.screenProbeBentNormal && knobs.bentNormal && occlusion
  return {
    ...knobs,
    values,
    level,
    enabled: casts,
    downsampleFactor: reference
      ? REFERENCE_MODE_SIDES.downsample
      : clamp(knobs.downsampleFactor / (quality >= 6 ? 2 : 1), ...DOWNSAMPLE_RANGE),
    jitterWidth: knobs.jitterWidth * (quality >= 4 ? 0.5 : 1),
    tracingResolution: reference ? REFERENCE_MODE_SIDES.tracing : tracingResolution,
    gatherResolution: reference ? REFERENCE_MODE_SIDES.gather : gatherResolution,
    spatialFilterPasses:
      values.screenProbeSpatialFilter && values.screenProbeSpatialFilterKernel > 0
        ? values.screenProbeSpatialFilterPasses
        : 0,
    maxFramesAccumulated: Math.max(1, Math.round(values.screenProbeMaxFramesAccumulated * speed)),
    radianceCache: values.screenProbeRadianceCache && casts,
    cache: resolveRadianceCache(values, rows, light),
    occlusion,
    occlusionDownsample: occlusionDownsampleOf(values, knobs.occlusionDownsample),
    integrateDownsample: integrateDownsampleOf(values, knobs.occlusionDownsample, casts, occlusion),
    ...switchesOf(values, knobs, casts, occlusion),
    bentNormal,
    finalGather: values.finalGatherMethod,
    irradianceField: irradianceFieldOf(values),
    // Only the spherical harmonics turn the normal toward the bent one, so an occlusion applied during the integration with it takes them.
    irradianceFormat:
      bentNormal && values.screenProbeShortRangeAOApplyDuringIntegration ? 'sh3' : format,
  }
}
