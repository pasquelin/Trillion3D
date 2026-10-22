import { nextPow2 } from '../../../math/src/scalar/integers.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import {
  ANY_NUMBER,
  choiceSetting as choice,
  countSetting as count,
  integerSetting as integer,
  flagSetting as flag,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  positiveSetting as positive,
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

/** The trace tiles of the radiance cache: `adaptive` the importance of the pixels' lobes picks each probe's, else one for all —
 *  `half`, `full` or `supersampled` the resolution the probe's map is traced at. */
export const RADIANCE_TRACE_TILES = ['adaptive', 'half', 'full', 'supersampled'] as const

/** The screen probes' settings by field, each with its default; `'ultra'` the level. */
export const SCREEN_PROBE_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choice('screenProbes', DEFAULT_SCREEN_PROBE_LEVEL, SCREEN_PROBE_LEVELS),
    positive('screenProbeQuality', 1, 'a finite number above 0'),
    positive('screenProbeUpdateSpeed', 1, 'a finite number above 0'),
    nonNegative('screenProbeAdaptiveFraction', SCREEN_PROBE_CONSTANTS.adaptiveFractionDefault),
    number('screenProbeGatherScale', 1, [0.1, 1]),
    flag('screenProbeScreenTraces', true),
    flag('screenProbeImportanceSampling', true),
    flag('screenProbeSpatialFilter', true),
    count('screenProbeSpatialFilterPasses', 3, 0),
    count('screenProbeSpatialFilterKernel', 1, 0),
    positive('screenProbeMaxRayIntensity', 10, 'a finite number above 0'),
    flag('screenProbeTemporal', true),
    count('screenProbeMaxFramesAccumulated', SCREEN_PROBE_CONSTANTS.maxFramesAccumulated, 1),
    count('screenProbeMaxRayDirections', SCREEN_PROBE_CONSTANTS.rayDirections, 1),
    flag('screenProbeMaterialAO', true),
    flag('screenProbeShortRangeOcclusion', true),
    number('screenProbeOcclusionIntensity', 1, [0, 1]),
    flag('screenProbeOcclusionTemporal', true),
    count('screenProbeOcclusionSteps', 3, 1),
    nonNegative('screenProbeOcclusionForegroundFraction', 0.3),
    nonNegative('screenProbeOcclusionMaxAlbedo', 0.5),
    number('screenProbeOcclusionClampScale', 1, ANY_NUMBER),
    flag('screenProbeSceneTraces', true),
    flag('screenProbeMeshTraces', false),
    positive('screenProbeMeshTraceDistance', 1.8, 'a finite number of metres above 0'),
    positive('screenProbeMeshTraceEndDistance', 40, 'a finite number of metres above 0'),
    number('screenProbeMaxTraceDistance', 200, [0.0001, 10485.76]),
    positive('screenProbeSurfaceBias', 0.05, 'a finite number of metres above 0'),
    nonNegative('screenProbeMinTraceDistance', 0),
    number('screenProbeInterpolationDepthWeight', 1, ANY_NUMBER),
    number('screenProbeInterpolationDepthWeightFallback', 0.1, ANY_NUMBER),
    positive('screenProbeHistoryDistanceThreshold', 0.01, 'a finite number above 0'),
    positive('screenProbeRelativeSpeedThreshold', 0.005, 'a finite number above 0'),
    positive('screenProbeFastUpdateFraction', 0.1, 'a finite number above 0'),
    number('screenProbeMaxFastUpdate', 0.9, [0, 1]),
    flag('screenProbeFastUpdateClamp', false),
    flag('screenProbeImportanceIncomingLighting', true),
    flag('screenProbeProbeRadianceHistory', true),
    number('screenProbeMinPdfToTrace', 0.1, [0, 1]),
    nonNegative('screenProbeSpatialFilterPositionWeightScale', 1000),
    number('screenProbeSpatialFilterMaxHitAngle', 10, [0.01, 180]),
    count('screenProbeDisocclusionMaxFrames', 4, 0),
    number('screenProbeDisocclusionFraction', 0.4, [0, 1]),
    positive('screenProbeHistoryDepthTestThickness', 0.005, 'a finite number above 0'),
    positive('screenProbeRelativeDepthThickness', 0.02, 'a finite number above 0'),
    count('screenProbeMaxIterations', 50, 0),
    flag('screenProbeRadianceCache', true),
    nonNegative('screenProbeRadianceCacheReprojectionRadiusScale', 1.5),
    flag('screenProbeRadianceCacheSpatialFilter', true),
    positive('screenProbeRadianceCacheFilterHitAngle', 0.2, 'a finite number of radians above 0'),
    choice('screenProbeRadianceCacheTraceTiles', 'adaptive', RADIANCE_TRACE_TILES),
    nonNegative('screenProbeRadianceCacheDownsampleDistance', 40),
    number('screenProbeRadianceCacheSupersampleDistance', -1, ANY_NUMBER),
    nonNegative('screenProbeRadianceCacheSupersampleThreshold', 0.1),
    integer('screenProbeRadianceCacheMipmaps', 1, [1, 3]),
    flag('screenProbeRadianceCacheSkyVisibility', false),
  ] as const))()
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
  /** Whether the far light comes from the radiance cache: the switch, over a level that casts. */
  radianceCache: boolean
  /** What the radiance cache — a map of the light by direction in every probe of the world's pool — is made of: the settings
   *  the world's probes trace it by, which every level but none needs (a level that casts no probe reads the probes' harmonics,
   *  made of the same pool). */
  cache: RadianceCacheSettings
  /** Whether the scene trace goes to the detail: the switch over a level that allows it. */
  meshTraces: boolean
  /** The inverse of the share of a pixel's light that must move for its history to give way. */
  fastUpdateInverseFraction: number
  /** Whether the rays' directions follow the light (the importance sampling's second half). */
  importanceLighting: boolean
}

/** Whether the short-range occlusion is searched and applied: its switch is on and its strength is above zero. */
export const searchesOcclusion = (switchedOn: boolean, intensity: number) =>
  switchedOn && intensity > 0

/** The radiance cache's settings, resolved (`resolveScreenProbes`). */
export interface RadianceCacheSettings {
  /** Texels along a side of a probe's map. */
  resolution: number
  /** Probes traced an image, in the cost of a whole map each (the update speed taken in, `screenProbeUpdateSpeed`). */
  budget: number
  /** How a probe's map is cut into the tiles that are traced (`RADIANCE_TRACE_TILES`). */
  tiles: (typeof RADIANCE_TRACE_TILES)[number]
  /** Whether a probe's map is averaged with its neighbours', and the angle that weighs them, in radians. */
  filter: boolean
  filterAngle: number
  /** The squares of the distances, in metres, past which a probe is traced at half its side, and within which it may be traced at
   *  twice it. */
  downsampleSq: number
  supersampleSq: number
  /** The share of the pixels' lobes above which a tile is traced again at twice the side. */
  supersampleThreshold: number
  /** The levels of detail of the final maps (a cone wider than a texel reads a coarser one), and whether the sky is kept apart from
   *  the light, as the share of a ray that left the scene, to be read from the sky itself. */
  mipmaps: number
  skyVisibility: boolean
}

/** The smallest tile the probes are cut at, and the largest. */
const DOWNSAMPLE_RANGE = [4, 64] as const
/** The octahedron's resolutions a probe may trace. */
const TRACING_RANGE = [4, 16] as const

/**
 * The numbers a view's screen probes run on, from its settings: the level's values, the quality's scales
 * (rays along a side the power of two over the truncated `√quality · tracingResolution`, four to sixteen; the tile
 * halved from a quality of six), the update speed's (the history's frames over `√clamp(speed, ½, 8)`), the gather
 * resolution (the tracing one over the whole number nearest the inverse of the gather scale), and the individual
 * switches. A tile is never under four pixels nor over sixty-four.
 */
export function resolveScreenProbes(values: ScreenProbeValues): ScreenProbeSettings {
  const level = values.screenProbes
  const knobs: LevelKnobs = {
    ...SCREEN_PROBE_LEVEL_KNOBS[castsProbes(level) ? level : DEFAULT_SCREEN_PROBE_LEVEL],
    ...(level === 'low' && SCREEN_PROBE_LOW_KNOBS),
  }
  const quality = values.screenProbeQuality
  const rows = SCREEN_PROBE_LEVEL_KNOBS[castsProbes(level) ? level : 'high']
  const tracingResolution = clamp(
    nextPow2(Math.trunc(Math.sqrt(quality) * knobs.tracingResolution)),
    ...TRACING_RANGE,
  )
  const speed = 1 / Math.sqrt(clamp(values.screenProbeUpdateSpeed, 0.5, 8))
  const divisor = Math.round(1 / Math.max(values.screenProbeGatherScale, 0.1))
  return {
    ...knobs,
    values,
    level,
    enabled: level !== 'off',
    casts: castsProbes(level),
    downsampleFactor: clamp(knobs.downsampleFactor / (quality >= 6 ? 2 : 1), ...DOWNSAMPLE_RANGE),
    jitterWidth: knobs.jitterWidth * (quality >= 4 ? 0.5 : 1),
    tracingResolution,
    gatherResolution: Math.max(1, Math.trunc(tracingResolution / divisor)),
    spatialFilterPasses:
      values.screenProbeSpatialFilter && values.screenProbeSpatialFilterKernel > 0
        ? values.screenProbeSpatialFilterPasses
        : 0,
    maxFramesAccumulated: Math.max(1, Math.round(values.screenProbeMaxFramesAccumulated * speed)),
    radianceCache: values.screenProbeRadianceCache && castsProbes(level),
    cache: {
      resolution: rows.radianceProbeResolution,
      budget: Math.round(rows.radianceProbeBudget * clamp(values.screenProbeUpdateSpeed, 0.5, 4)),
      tiles: values.screenProbeRadianceCacheTraceTiles,
      filter: values.screenProbeRadianceCacheSpatialFilter,
      filterAngle: values.screenProbeRadianceCacheFilterHitAngle,
      downsampleSq: values.screenProbeRadianceCacheDownsampleDistance ** 2,
      supersampleSq: Math.max(values.screenProbeRadianceCacheSupersampleDistance, 0) ** 2,
      supersampleThreshold: values.screenProbeRadianceCacheSupersampleThreshold,
      mipmaps: values.screenProbeRadianceCacheMipmaps,
      skyVisibility: values.screenProbeRadianceCacheSkyVisibility,
    },
    occlusion: searchesOcclusion(
      values.screenProbeShortRangeOcclusion,
      values.screenProbeOcclusionIntensity,
    ),
    meshTraces: values.screenProbeMeshTraces && knobs.meshTraces,
    fastUpdateInverseFraction: 1 / values.screenProbeFastUpdateFraction,
    importanceLighting:
      values.screenProbeImportanceSampling && values.screenProbeImportanceIncomingLighting,
  }
}
