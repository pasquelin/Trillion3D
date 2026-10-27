import { nextPow2 } from '../../../math/src/scalar/integers.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
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
  SCREEN_PROBE_LOW_KNOBS,
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
 * lights nothing the probes do, `'low'` reads the world's probes under the short-range occlusion, `'high'`,
 * `'ultra'` (the default) and `'cinematic'` cast probes and each hold the values of their row of
 * `SCREEN_PROBE_LEVEL_KNOBS`; `true` is the default level and `false` `'off'`, as the temporal anti-aliasing's
 * level reads them (`resolveSetting`). The other settings are individual switches, each with its own default,
 * the reference's, in the units of the engine (metres).
 */

/** The furthest a ray looks for a surface by default, in metres (`screenProbeMaxTraceDistance`): the one distance the probes, the
 *  reflections and the lighting of the surface cache trace to, clamped to the range the rule allows, whatever the scene's size. */
export const MAX_TRACE_DISTANCE_METRES = 200

/** The trace tiles of the radiance cache: `half`, `full` or `supersampled` the resolution every probe's map is traced at. `full`, the
 *  default, traces every probe at the whole side, half of it past the downsample distance and twice it within the supersample distance. */
const RADIANCE_TRACE_TILES = ['half', 'full', 'supersampled'] as const

/** The octahedron's resolutions a probe may trace. */
const TRACING_RANGE = [4, 16] as const

/** The most levels of detail the probes' filtered radiance holds (`screenProbeGatherNumMips`): the border of the finest level is `2 ** levels` texels,
 *  and a probe's square of texels, the widest gather over the tracing's range plus that border, must fit the 8192 texels a texture measures
 *  on any WebGPU device (`maxTextureDimension2D`'s default). The constant bounds the option; the device bounds the view: a device
 *  whose own `maxTextureDimension2D` is smaller doubles the probes' tile, and refuses the view when the atlas still does not fit (`atlasFits`,
 *  in the screen probes' layout). The floor of log2(8192 − 16), the widest tracing, written out so that no bundle runs it. */
const MAX_GATHER_MIPS = 12

/** The level, the probes, their filtering, their history and the short-range occlusion. */
const PLACEMENT_AND_OCCLUSION_RULES = /* @__PURE__ */ (() =>
  [
    choice('screenProbes', DEFAULT_SCREEN_PROBE_LEVEL, SCREEN_PROBE_LEVELS),
    positive('screenProbeQuality', 1),
    positive('screenProbeUpdateSpeed', 1),
    nonNegative('screenProbeAdaptiveFraction', SCREEN_PROBE_CONSTANTS.adaptiveFractionDefault),
    number('screenProbeGatherScale', 1, [0.1, 1]),
    flag('screenProbeScreenTraces', true),
    flag('screenProbeImportanceSampling', true),
    flag('screenProbeSpatialFilter', true),
    count('screenProbeSpatialFilterPasses', 3, 0),
    count('screenProbeSpatialFilterKernel', 1, 0),
    positive('screenProbeMaxRayIntensity', 10),
    flag('screenProbeTemporal', true),
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
    count('screenProbeOcclusionSteps', 3, 1),
    nonNegative('screenProbeOcclusionForegroundFraction', 0.3),
    nonNegative('screenProbeOcclusionMaxAlbedo', 0.5),
    number('screenProbeOcclusionClampScale', 1, ANY_NUMBER),
    number('screenProbeOcclusionFoliageStrength', -1, [-1, 1]),
    flag('screenProbeShortRangeAOApplyDuringIntegration', false),
    integer('screenProbeShortRangeAODownsampleFactor', -1, [-1, 2]),
    integer('screenProbeIntegrateDownsampleFactor', 1, [1, 2]),
  ] as const)()

/** The scene traces, the history thresholds, the screen trace and the radiance cache. */
const TRACE_AND_CACHE_RULES = /* @__PURE__ */ (() =>
  [
    flag('screenProbeSceneTraces', true),
    number('screenProbeMaxTraceDistance', MAX_TRACE_DISTANCE_METRES, [0.0001, 10485.76]),
    positive('screenProbeSurfaceBias', 0.05, 'a finite number of metres above 0'),
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
    nonNegative('screenProbeRadianceCacheReprojectionRadiusScale', 1.5),
    count('screenProbeRadianceCacheFramesToKeepProbes', 8, 0),
    integer('screenProbeRadianceCacheTemporaryAtlasDownsampleFactor', 6, [1, 1024]),
    integer('screenProbeMarkDownsampleFactor', 2, [1, 8]),
    integer('screenProbeInterpolateDownsampleFactor', 2, [1, 2]),
    flag('screenProbeRadianceCacheSpatialFilter', true),
    positive('screenProbeRadianceCacheFilterHitAngle', 0.2, 'a finite number of radians above 0'),
    choice('screenProbeRadianceCacheTraceTiles', 'full', RADIANCE_TRACE_TILES),
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

/** The screen probes' settings by field, each with its default; `'ultra'` the level. */
export const SCREEN_PROBE_RULES = /* @__PURE__ */ (() =>
  rulesOf([...PLACEMENT_AND_OCCLUSION_RULES, ...TRACE_AND_CACHE_RULES] as const))()
/** The screen probes setting `field` of a runtime's context (`contextReader`): its default where the
 *  context holds none. */
export const readScreenProbeSetting = /* @__PURE__ */ contextReader(SCREEN_PROBE_RULES)
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
  /** Whether the view casts screen probes: the levels from `'high'`. */
  casts: boolean
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
  /** Whether the occlusion keeps its bent normal: the switch over a level that allows it, with the occlusion searched. */
  bentNormal: boolean
  /** Whether the pixels of a thin double-sided sheet gather the light along their backface: the switch over a level that allows it. */
  backfaceDiffuse: boolean
  /** Whether the far light comes from the radiance cache: the switch, over a level that casts. */
  radianceCache: boolean
  /** What the radiance cache — a map of the light by direction in every probe of the world's pool — is made of: the settings
   *  the world's probes trace it by, which every level that casts needs. */
  cache: RadianceCacheSettings
  /** The inverse of the share of a pixel's light that must move for its history to give way. */
  fastUpdateInverseFraction: number
  /** Whether the rays' directions follow the light (the importance sampling's second half). */
  importanceLighting: boolean
  /** The linear steps along the ray past a hit that look for a thin feature (0 while foliage hits are skipped). */
  thicknessCertaintySteps: number
  /** Whether a probe's composited radiance is blended with the last image's (`screenProbeTemporalFilterProbes`), over a level that casts. */
  temporalFilterProbes: boolean
  /** Whether the probes keep an ambient occlusion of their own beside their radiance (`screenProbeExtraAmbientOcclusion`), over a level that casts. */
  extraAo: boolean
  /** The levels of detail of the probes' filtered radiance (`screenProbeGatherNumMips`): each level halves the side, border included, which is the
   *  gather's plus two to the power of the levels. */
  gatherMips: number
}

/** Whether the short-range occlusion is searched and applied: its switch is on and its strength is above zero. */
export const searchesOcclusion = (switchedOn: boolean, intensity: number) =>
  switchedOn && intensity > 0

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
  /** The scale of the nearest a probe's ray starts at, over its cell's diagonal. */
  minTraceScale: number
}

/** The scales of the update speed the radiance cache's budget takes in: the speed is held between them. */
const BUDGET_SPEED_RANGE = [0.5, 4] as const
/** The smallest tile the probes are cut at, and the largest. */
const DOWNSAMPLE_RANGE = [4, 64] as const
/** The radiance cache's settings of a view's screen probes, from the settings and the level's row. */
function resolveRadianceCache(values: ScreenProbeValues, rows: LevelKnobs): RadianceCacheSettings {
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
    filter: values.screenProbeRadianceCacheSpatialFilter,
    filterAngle: values.screenProbeRadianceCacheFilterHitAngle,
    downsampleSq: values.screenProbeRadianceCacheDownsampleDistance ** 2,
    supersampleSq: Math.max(values.screenProbeRadianceCacheSupersampleDistance, 0) ** 2,
    mipmaps: values.screenProbeRadianceCacheMipmaps,
    skyVisibility: values.screenProbeRadianceCacheSkyVisibility,
    minTraceScale: SCREEN_PROBE_CONSTANTS.radianceProbeMinTraceScale,
  }
}

/** A setting that names the level's row by a negative value: its value where it is one, else the row's. */
const namedOr = (asked: number, row: number) => (asked < 0 ? row : asked)

/** The reduction the short-range occlusion is searched at, as asked: the setting's, from 1 to 2, else the level's row (the level's value of the setting). */
const requestedOcclusionDownsample = (values: ScreenProbeValues, level: number) => {
  const asked = values.screenProbeShortRangeAODownsampleFactor
  return asked < 0 ? level : clamp(asked, 1, 2)
}

/** The reduction the integration is asked to run at (`screenProbeIntegrateDownsampleFactor`), from 1 to 2. */
const requestedIntegrateDownsample = (values: ScreenProbeValues) =>
  clamp(values.screenProbeIntegrateDownsampleFactor, 1, 2)

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
 *  pass from the four texels round them. The one asked, else 1 where the level casts no probe, or where the occlusion is searched and applied during
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

/**
 * The numbers a view's screen probes run on, from its settings: the level's values, the quality's scales
 * (rays along a side the power of two over the truncated `√quality · tracingResolution`, four to sixteen; the tile
 * halved from a quality of six), the update speed's (the history's frames over `√clamp(speed, ½, 8)`), the gather
 * resolution (the tracing one over the whole number nearest the inverse of the gather scale), and the individual
 * switches. A tile is never under four pixels nor over sixty-four.
 */
export function resolveScreenProbes(values: ScreenProbeValues): ScreenProbeSettings {
  const level = values.screenProbes
  const casts = castsProbes(level)
  const knobs: LevelKnobs = {
    ...SCREEN_PROBE_LEVEL_KNOBS[casts ? level : DEFAULT_SCREEN_PROBE_LEVEL],
    ...(level === 'low' && SCREEN_PROBE_LOW_KNOBS),
  }
  const quality = values.screenProbeQuality
  const rows = SCREEN_PROBE_LEVEL_KNOBS[casts ? level : 'high']
  const tracingResolution = clamp(
    nextPow2(Math.trunc(Math.sqrt(quality) * knobs.tracingResolution)),
    ...TRACING_RANGE,
  )
  const speed = 1 / Math.sqrt(clamp(values.screenProbeUpdateSpeed, 0.5, 8))
  const divisor = Math.round(1 / Math.max(values.screenProbeGatherScale, 0.1))
  const gatherResolution = Math.max(1, Math.trunc(tracingResolution / divisor))
  const occlusion = searchesOcclusion(
    values.screenProbeShortRangeOcclusion,
    values.screenProbeOcclusionIntensity,
  )
  return {
    ...knobs,
    values,
    level,
    enabled: level !== 'off',
    casts,
    downsampleFactor: clamp(knobs.downsampleFactor / (quality >= 6 ? 2 : 1), ...DOWNSAMPLE_RANGE),
    jitterWidth: knobs.jitterWidth * (quality >= 4 ? 0.5 : 1),
    tracingResolution,
    gatherResolution,
    spatialFilterPasses:
      values.screenProbeSpatialFilter && values.screenProbeSpatialFilterKernel > 0
        ? values.screenProbeSpatialFilterPasses
        : 0,
    maxFramesAccumulated: Math.max(1, Math.round(values.screenProbeMaxFramesAccumulated * speed)),
    radianceCache: values.screenProbeRadianceCache && casts,
    cache: resolveRadianceCache(values, rows),
    occlusion,
    occlusionDownsample: occlusionDownsampleOf(values, knobs.occlusionDownsample),
    integrateDownsample: integrateDownsampleOf(values, knobs.occlusionDownsample, casts, occlusion),
    bentNormal: values.screenProbeBentNormal && knobs.bentNormal && occlusion,
    occlusionFoliageStrength: namedOr(
      values.screenProbeOcclusionFoliageStrength,
      knobs.occlusionFoliageStrength,
    ),
    backfaceDiffuse: values.screenProbeTwoSidedFoliageBackfaceDiffuse && knobs.backfaceDiffuse,
    fastUpdateInverseFraction: 1 / values.screenProbeFastUpdateFraction,
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
