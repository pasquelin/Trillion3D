import { nextPow2 } from '../../../math/src/scalar/integers.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import {
  choiceSetting as choice,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  positiveSetting as positive,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from '../contracts/settingRules.ts'

import {
  DEFAULT_SCREEN_PROBE_LEVEL,
  SCREEN_PROBE_CONSTANTS,
  SCREEN_PROBE_LEVELS,
  SCREEN_PROBE_LEVEL_KNOBS,
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
 * casts no probe — the pixel then reads the world probes, as before the screen probes —, `'high'`, `'ultra'`
 * (the default) and `'cinematic'` each hold the values of their row of `SCREEN_PROBE_LEVEL_KNOBS`; `true` is the
 * default level and `false` `'off'`, as the temporal anti-aliasing's level reads them (`resolveSetting`). The other
 * settings are individual switches, each with its own default.
 */

/** The screen probes' settings by field, each with its default; `'ultra'` the level. */
export const SCREEN_PROBE_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choice('screenProbes', DEFAULT_SCREEN_PROBE_LEVEL, SCREEN_PROBE_LEVELS),
    positive('screenProbeQuality', 1, 'a finite number above 0'),
    positive('screenProbeUpdateSpeed', 1, 'a finite number above 0'),
    number('screenProbeAdaptiveFraction', SCREEN_PROBE_CONSTANTS.adaptiveFractionDefault, [0, 1]),
    flag('screenProbeScreenTraces', true),
    flag('screenProbeImportanceSampling', true),
    flag('screenProbeSpatialFilter', true),
    integer('screenProbeSpatialFilterPasses', 3, [0, 8]),
    positive('screenProbeMaxRayIntensity', 10, 'a finite number above 0'),
    flag('screenProbeTemporal', true),
    integer(
      'screenProbeMaxFramesAccumulated',
      SCREEN_PROBE_CONSTANTS.maxFramesAccumulated,
      [1, 15],
    ),
    flag('screenProbeShortRangeOcclusion', true),
    number('screenProbeOcclusionIntensity', 1, [0, 1]),
    flag('screenProbeSceneTraces', true),
    flag('screenProbeMeshTraces', false),
    number('screenProbeMeshTraceDistance', 1.8, [0.01, SCREEN_PROBE_CONSTANTS.maxTraceDistance]),
    positive('screenProbeMeshTraceEndDistance', 40, 'a finite number of metres above 0'),
    positive('screenProbeSurfaceBias', 0.05, 'a finite number of metres above 0'),
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
    integer('screenProbeDisocclusionMaxFrames', 4, [1, 15]),
    number('screenProbeDisocclusionFraction', 0.4, [0, 1]),
    positive('screenProbeHistoryDepthTestThickness', 0.005, 'a finite number above 0'),
    positive('screenProbeRelativeDepthThickness', 0.02, 'a finite number above 0'),
    integer('screenProbeMaxIterations', 50, [1, 256]),
  ] as const))()
/** The field of one setting of the screen probes. */
export type ScreenProbeField = keyof typeof SCREEN_PROBE_RULES
/** The screen probes' settings as a host writes them, by their fields: each its value, or nothing for its
 *  default. */
export type ScreenProbeOptions = SettingOptions<typeof SCREEN_PROBE_RULES>

/** The values of every setting, resolved (`resolveSettings`). */
export type ScreenProbeValues = SettingValues<typeof SCREEN_PROBE_RULES>

/** What a view's screen probes are, every number the passes read, from the settings (`resolveScreenProbes`). */
export type ScreenProbeSettings = LevelKnobs & {
  /** The level the settings were resolved at. */
  level: ScreenProbeLevel
  /** Whether the view casts screen probes at all: false at the level `'off'`. */
  enabled: boolean
  adaptiveFraction: number
  screenTraces: boolean
  importanceSampling: boolean
  spatialFilterPasses: number
  maxRayIntensity: number
  temporal: boolean
  maxFramesAccumulated: number
  occlusion: boolean
  occlusionIntensity: number
  /** Whether a ray the screen left is traced against the scene's coarse geometry, and, over a level that
   *  allows it, against its detail: how far, for the probes within what distance of the eye, from how far
   *  off a surface (metres). */
  sceneTraces: boolean
  meshTraces: boolean
  meshTraceDistance: number
  meshTraceEndDistance: number
  surfaceBias: number
  /** The relative depth past which a pixel's history is another surface's, and the relative speed
   *  difference from which a ray's end counts as moving. */
  historyDistanceThreshold: number
  relativeSpeedThreshold: number
  /** The share of a pixel's light that must move for the history to give way (as its inverse), the most the
   *  history gives way by, and whether the history is held to the new light's neighbourhood meanwhile. */
  fastUpdateInverseFraction: number
  maxFastUpdate: number
  fastUpdateClamp: boolean
  /** Whether the rays' directions follow the light (the importance sampling's second half), whether the light is the
   *  last image's probes (else the world's field alone), and the probability under which a ray is not worth tracing. */
  importanceLighting: boolean
  radianceHistory: boolean
  minPdfToTrace: number
  /** The spatial filter: the scale of a neighbour's depth weight and the angle (degrees) past which its light
   *  weighs nothing; the frames a probe's pixels hold under which the probe is disoccluded, and the share of them
   *  that makes it so. */
  filterPositionWeightScale: number
  filterHitAngleDegrees: number
  disocclusionMaxFrames: number
  disocclusionFraction: number
  /** The screen trace: the relative depth difference past which a hit of the last image is another surface, the
   *  relative thickness of the depth the march crosses, its iterations. */
  traceHistoryThickness: number
  relativeDepthThickness: number
  maxIterations: number
}

/** The frames a pixel's history may hold at most: its count is kept in four bits. */
const MAX_FRAMES_KEPT = 15
/** The smallest tile the probes are cut at, and the largest. */
const DOWNSAMPLE_RANGE = [4, 64] as const
/** The octahedron's resolutions a probe may trace. */
const TRACING_RANGE = [4, 16] as const

/**
 * The numbers a view's screen probes run on, from its settings: the level's values, the quality's scales
 * (rays along a side the power of two over `√quality · tracingResolution`, four to sixteen; the tile
 * halved from a quality of six), the update speed's (the history's frames over `√clamp(speed, ½, 8)`), and
 * the individual switches. A tile is never under four pixels nor over sixty-four.
 */
export function resolveScreenProbes(values: ScreenProbeValues): ScreenProbeSettings {
  const level = values.screenProbes
  const knobs = SCREEN_PROBE_LEVEL_KNOBS[level === 'off' ? DEFAULT_SCREEN_PROBE_LEVEL : level]
  const quality = values.screenProbeQuality
  const tracingResolution = clamp(
    nextPow2(Math.sqrt(quality) * knobs.tracingResolution),
    ...TRACING_RANGE,
  )
  const speed = 1 / Math.sqrt(clamp(values.screenProbeUpdateSpeed, 0.5, 8))
  return {
    ...knobs,
    level,
    enabled: level !== 'off',
    downsampleFactor: clamp(knobs.downsampleFactor / (quality >= 6 ? 2 : 1), ...DOWNSAMPLE_RANGE),
    jitterWidth: knobs.jitterWidth * (quality >= 4 ? 0.5 : 1),
    tracingResolution,
    adaptiveFraction: values.screenProbeAdaptiveFraction,
    screenTraces: values.screenProbeScreenTraces,
    importanceSampling: values.screenProbeImportanceSampling,
    spatialFilterPasses: values.screenProbeSpatialFilter
      ? values.screenProbeSpatialFilterPasses
      : 0,
    maxRayIntensity: values.screenProbeMaxRayIntensity,
    temporal: values.screenProbeTemporal,
    maxFramesAccumulated: clamp(
      Math.round(values.screenProbeMaxFramesAccumulated * speed),
      1,
      MAX_FRAMES_KEPT,
    ),
    occlusion: values.screenProbeShortRangeOcclusion && values.screenProbeOcclusionIntensity > 0,
    occlusionIntensity: values.screenProbeOcclusionIntensity,
    sceneTraces: values.screenProbeSceneTraces,
    meshTraces: values.screenProbeMeshTraces && knobs.meshTraces,
    meshTraceDistance: values.screenProbeMeshTraceDistance,
    meshTraceEndDistance: values.screenProbeMeshTraceEndDistance,
    surfaceBias: values.screenProbeSurfaceBias,
    historyDistanceThreshold: values.screenProbeHistoryDistanceThreshold,
    relativeSpeedThreshold: values.screenProbeRelativeSpeedThreshold,
    fastUpdateInverseFraction: 1 / values.screenProbeFastUpdateFraction,
    maxFastUpdate: values.screenProbeMaxFastUpdate,
    fastUpdateClamp: values.screenProbeFastUpdateClamp,
    importanceLighting:
      values.screenProbeImportanceSampling && values.screenProbeImportanceIncomingLighting,
    radianceHistory: values.screenProbeProbeRadianceHistory,
    minPdfToTrace: values.screenProbeMinPdfToTrace,
    filterPositionWeightScale: values.screenProbeSpatialFilterPositionWeightScale,
    filterHitAngleDegrees: values.screenProbeSpatialFilterMaxHitAngle,
    disocclusionMaxFrames: values.screenProbeDisocclusionMaxFrames,
    disocclusionFraction: values.screenProbeDisocclusionFraction,
    traceHistoryThickness: values.screenProbeHistoryDepthTestThickness,
    relativeDepthThickness: values.screenProbeRelativeDepthThickness,
    maxIterations: values.screenProbeMaxIterations,
  }
}
