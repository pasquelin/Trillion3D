import { DEG2RAD } from '../../../math/src/constants.ts'
import { BOUNCE_SETTINGS } from '../bounce/contracts.ts'
import {
  resolveScreenProbes,
  SCREEN_PROBE_RULES,
  type ScreenProbeSettings,
} from '../bounce/screenProbeOptions.ts'
import {
  ANY_NUMBER,
  choiceSetting as choice,
  countSetting as count,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  positiveSetting as positive,
  resolveSettings,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'
import {
  DEFAULT_REFLECTION_LEVEL,
  REFLECTION_LEVEL_KNOBS,
  REFLECTION_LEVELS,
  type ReflectionLevel,
} from './reflectionLevels.ts'

/**
 * The reflections: what a reflected ray may spend on its way, stage by stage — the screen first, then
 * the scene's detail window and its rings, then the screen again for the far distance, then the
 * environment — and how the rays are filtered. Run-time settings, as `./settingRules.ts` says: no
 * compiler job names them, so no manifest carries them; each is read again at each image by the trace
 * (`packages/sdk-browser/src/lighting/reflections/`), and each default is the reference's.
 *
 * LEVELS. `reflectionQuality` names one quality level (`REFLECTION_LEVELS`, `./reflectionLevels.ts`): `'off'` traces
 * no ray, every surface reads the probes' field alone; `'high'`, `'ultra'` (the default) and `'cinematic'` trace
 * and hold the values of their row of `REFLECTION_LEVEL_KNOBS`; `true` is the default level and `false` `'off'`, as
 * the temporal anti-aliasing's level reads them (`resolveSetting`). The other settings are individual, each
 * with its own default.
 *
 * THE SCREEN: a ray first marches the depth pyramid and reads the last lit image where it meets a
 * surface (`reflectionScreenTraces`), `reflectionScreenSteps` iterations at most (50), a surface being as thick
 * as `reflectionRelativeDepthThickness` (0.5 %) of its depth. The march is strict: a ray that passes behind a
 * surface gives the screen up, one that spends its iterations has hit nothing, and either hands the ray over to the
 * scene where it stopped knowing.
 *
 * THE SCENE, in rings: the cascades' four cubes about the eye (the cells of the world's probes, 25, 50,
 * 100 and 200 m from it) cut the ray into as many segments, from the finest cube that holds its start
 * to the outermost; each is walked on its own, `reflectionRingSteps` steps at most (256), the nearest
 * surface of the segment ending the ray. A ring that spends its steps before it found a surface is no
 * hit: the ray goes on at its end; one that found a surface keeps it. A ray that meets nothing in any
 * ring goes on to the screen's far trace, then to the environment. A step is the unit the reference
 * counts a distance field's march in; the tracer counts work, a box tested, a node visited, a triangle
 * tested (`BOUNCE_SETTINGS.probeRayWork`), and a step stands for `REFLECTION_WORK_PER_STEP` units of it, the
 * proportion the probes' own ray already holds between the reference's longest ray (four rings of 256
 * steps) and the work the tracer gives it. The unit is ours, not a measure of the reference's distance
 * field: a ring's cost follows the placements it crosses, so the setting's reach in a dense scene is the
 * number of placements a ring can enter. The cubes' edges are drawn in by one voxel of
 * `reflectionRingResolution` (252) across the cube. The scene trace has one switch, the screen probes'
 * (`screenProbeSceneTraces`, `../bounce/screenProbeOptions.ts`): off, a ray goes from the screen to the sky,
 * in the reflections as in the probes. A hit the screen agrees with takes the lit image
 * (`reflectionSampleSceneColor`), the lighting of every trace is fogged along the ray (`reflectionHeightFog`) and
 * none brings back more than `reflectionMaxRayIntensity` (40).
 *
 * THE DETAIL WINDOW, ahead of the rings: the reference traces the first metres of a ray against each
 * mesh's own distance field when its project asks for it (`screenProbeMeshTraces`, off by default, and a
 * level that allows it) and `reflectionMeshTraces` (on: the reflections' own switch) says so. Here it is
 * the same proxy walked over `screenProbeMeshTraceDistance` (1.8 m) on a budget of `reflectionDetailSteps` (64)
 * steps; what it finds, or where a walk that spends them stopped, is a hit by noise against a fade that grows
 * with the distance of the surface from the eye (`screenProbeMeshTraceEndDistance`, 40 m) and with the
 * result's from the window's end, else the rings go on there.
 *
 * THE FAR SCREEN TRACE, after the rings: a ray that left the outermost cube looks once more at what the
 * screen shows, linearly, from where it left the cube up to `reflectionDistantScreenDistance` (2 000 m), in
 * `reflectionDistantScreenSteps` (16) steps jittered by noise and `reflectionDistantScreenOffsetBias` (0), a
 * surface within `reflectionDistantScreenDepthThreshold` (2) of the slope of the ray hit, before the
 * environment answers; `reflectionDistantScreenTraces` turns it off.
 *
 * THE DENOISER: a pixel resolves its reflection from the rays round it (`reflectionReconstruction`, over
 * `reflectionReconstructionRadius` pixels), accumulates it over `reflectionMaxFramesAccumulated` images under a
 * clamp (`reflectionTemporal`, `reflectionNeighborhoodClampScale`, `reflectionHistoryDistanceThreshold`) and filters
 * it last where its history is short (`reflectionBilateralFilter`); a lobe rougher than
 * `reflectionMaxRoughnessToTrace` casts no ray, the probes' field answering it, over a fade of
 * `reflectionRoughnessFadeLength`.
 */

/** The steps of the reference's scene trace in each ring, and the rings it has: the bounds of its longest
 *  ray, over which the engine holds its probes' work (`BOUNCE_SETTINGS.probeRayWork`). The rings are the
 *  reference's four clipmaps, which the engine's four cascades follow (`BOUNCE_SETTINGS.cascadeLevels`). */
const REFERENCE_RING_STEPS = 256
const REFERENCE_RINGS = 4

/** The tracer's work, in units (`lighting/bounce/runtime/runtimeLayout.ts`), that one step of the scene
 *  trace stands for: the probes' work over the reference's longest ray, four units. */
export const REFLECTION_WORK_PER_STEP =
  BOUNCE_SETTINGS.probeRayWork / (REFERENCE_RINGS * REFERENCE_RING_STEPS)
/** The triangle tests of the tracer that one step stands for, in the same proportion. */
export const REFLECTION_TESTS_PER_STEP =
  BOUNCE_SETTINGS.probeRayTriangles / (REFERENCE_RINGS * REFERENCE_RING_STEPS)

const METRES = 'a finite number of metres above 0'
const ABOVE_ZERO = 'a finite number above 0'

/** The reflections' settings by field, each with the reference's default; `'ultra'` the level. */
export const REFLECTION_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choice('reflectionQuality', DEFAULT_REFLECTION_LEVEL, REFLECTION_LEVELS),
    flag('reflectionScreenTraces', true),
    count('reflectionScreenSteps', 50, 1),
    positive('reflectionRelativeDepthThickness', 0.005, ABOVE_ZERO),
    count('reflectionRingSteps', REFERENCE_RING_STEPS, 1),
    count('reflectionRingResolution', 252, 1),
    flag('reflectionMeshTraces', true),
    count('reflectionDetailSteps', 64, 1),
    flag('reflectionDistantScreenTraces', true),
    count('reflectionDistantScreenSteps', 16, 1),
    positive('reflectionDistantScreenDistance', 2000, METRES),
    positive('reflectionDistantScreenDepthThreshold', 2, ABOVE_ZERO),
    number('reflectionDistantScreenOffsetBias', 0, ANY_NUMBER),
    integer('reflectionSampleSceneColor', 1, [0, 2]),
    positive('reflectionSampleSceneColorDepthThickness', 0.01, ABOVE_ZERO),
    number('reflectionSampleSceneColorNormalThreshold', 85, [0, 180]),
    flag('reflectionHeightFog', true),
    positive('reflectionMinDistanceForFoggingSky', 1000, METRES),
    positive('reflectionMaxRayIntensity', 40, ABOVE_ZERO),
    flag('reflectionTemporal', true),
    count('reflectionMaxFramesAccumulated', 12, 1),
    number('reflectionNeighborhoodClampScale', 1, ANY_NUMBER),
    count('reflectionMaxRayDirections', 1024, 1),
    positive('reflectionHistoryDistanceThreshold', 0.03, ABOVE_ZERO),
    nonNegative('reflectionDenoiserTonemapRange', 10),
    flag('reflectionReconstruction', true),
    positive('reflectionReconstructionRadius', 8, 'a finite number of pixels above 0'),
    flag('reflectionBilateralFilter', true),
    positive('reflectionBilateralRadius', 8, 'a finite number of pixels above 0'),
    count('reflectionBilateralSamples', 4, 0),
    count('reflectionBilateralDisocclusionFrames', 2, 1),
    number('reflectionMaxRoughnessToTrace', 0.4, [0, 1]),
    positive('reflectionRoughnessFadeLength', 0.1, ABOVE_ZERO),
    number('reflectionGGXSamplingBias', 0.1, [0, 1]),
  ] as const))()
/** The field of one setting of the reflections. */
export type ReflectionField = keyof typeof REFLECTION_RULES
/** The reflections' settings as a host writes them, by their fields: each its value, or nothing for
 *  its default. */
export type ReflectionOptions = SettingOptions<typeof REFLECTION_RULES>
/** The values of the reflections' settings, resolved. */
export type ReflectionValues = SettingValues<typeof REFLECTION_RULES>

/** What a view's reflection rays are spent on: every number the trace reads, in the tracer's units. */
export interface ReflectionSettings {
  /** The level the settings were resolved at, and whether the view traces at all: false at `'off'`. */
  level: ReflectionLevel
  enabled: boolean
  /** The level's row: the side of the blocks a ray is traced for, the neighbours' rays a pixel reads at most, and the
   *  least share of its own weight they weigh. */
  block: number
  reconstructionSamples: number
  reconstructionMinWeight: number
  /** The iterations of the screen march, and of the far one. */
  screenSteps: number
  distantSteps: number
  /** The work and the triangle tests of a ring's walk, and of the detail window's. */
  ringWork: number
  ringTests: number
  detailWork: number
  detailTests: number
  /** Whether the screen is traced, the scene, its first metres in detail, and whether the screen looks again past the
   *  rings; whether a hit the screen agrees with takes the lit image; whether the lighting is fogged along its ray. */
  screenTraces: boolean
  sceneTraces: boolean
  meshTraces: boolean
  distantTraces: boolean
  sampleSceneColor: boolean
  heightFog: boolean
  /** The detail window's length, the distance from the eye at which its hits fade out, the metres a ray
   *  leaves a surface by at least, and the far trace's length. */
  meshDistance: number
  meshEndDistance: number
  surfaceBias: number
  distantDistance: number
  /** The voxels across a ring's cube, the thickness of a surface of the screen march in its depth, the far
   *  trace's slope tolerance and offset bias, the longest ray in metres, the most radiance a ray brings back. */
  ringResolution: number
  relativeThickness: number
  distantTolerance: number
  distantOffsetBias: number
  traceDistance: number
  maxRayIntensity: number
  /** The depth thickness and the cosine of the angle a hit's face may turn from the eye to take the lit image, and
   *  the metres from which a ray that leaves the scene is fogged. */
  sampleDepthThickness: number
  sampleFacing: number
  fogSkyDistance: number
  /** The denoiser: its three passes, the images a history holds, the clamp's scale, the sequence of ray directions
   *  (its period), the history's distance threshold, the tonemap range, the reconstruction's radius, the bilateral
   *  filter's radius, taps and disocclusion frames, the roughness past which a lobe casts no ray, the fade to it
   *  and the sampling's bias. */
  temporal: boolean
  reconstruction: boolean
  bilateral: boolean
  historyFrames: number
  clampScale: number
  rayDirections: number
  historyDistance: number
  tonemapRange: number
  reconstructionRadius: number
  bilateralRadius: number
  bilateralSamples: number
  disocclusionFrames: number
  maxRoughness: number
  roughnessFade: number
  samplingBias: number
}

/** The most a lane of the view holds, a `u32`. */
const LANE_MOST = 0xffffffff

/** The work and the triangle tests `steps` steps of the scene trace are, in the tracer's units. */
const stepsAre = (steps: number) => ({
  work: Math.min(steps * REFLECTION_WORK_PER_STEP, LANE_MOST),
  tests: Math.min(steps * REFLECTION_TESTS_PER_STEP, LANE_MOST),
})

/**
 * The reflections' settings `values` over the screen probes' `probes` — the scene trace's switch, the
 * detail window's, its length and its fade's, the bias a ray leaves a surface by, the longest ray are the reference's
 * shared ones, the probes' own —: the numbers the trace reads. The one derivation of a ring's budget, and of the level's
 * row: a level that traces holds its block, its reconstruction's samples and weight; `'off'` casts no ray (a lobe
 * rougher than zero traces nothing), the default row's values standing in the numbers the view still reads.
 */
export function resolveReflections(
  values: ReflectionValues,
  probes: ScreenProbeSettings,
): ReflectionSettings {
  const level = values.reflectionQuality
  const enabled = level !== 'off'
  const knobs = REFLECTION_LEVEL_KNOBS[enabled ? level : DEFAULT_REFLECTION_LEVEL]
  const ring = stepsAre(values.reflectionRingSteps)
  const detail = stepsAre(values.reflectionDetailSteps)
  const screenTraces = values.reflectionScreenTraces
  const sample = values.reflectionSampleSceneColor
  return {
    level,
    enabled,
    block: knobs.downsample,
    reconstructionSamples: knobs.reconstructionSamples,
    reconstructionMinWeight: knobs.reconstructionMinWeight,
    screenSteps: values.reflectionScreenSteps,
    distantSteps: values.reflectionDistantScreenSteps,
    ringWork: ring.work,
    ringTests: ring.tests,
    detailWork: detail.work,
    detailTests: detail.tests,
    screenTraces,
    sceneTraces: probes.values.screenProbeSceneTraces,
    meshTraces: values.reflectionMeshTraces && probes.meshTraces,
    distantTraces: values.reflectionDistantScreenTraces && screenTraces,
    sampleSceneColor: sample === 2 || (sample === 1 && screenTraces),
    heightFog: values.reflectionHeightFog,
    meshDistance: probes.values.screenProbeMeshTraceDistance,
    meshEndDistance: probes.values.screenProbeMeshTraceEndDistance,
    surfaceBias: probes.values.screenProbeSurfaceBias,
    distantDistance: values.reflectionDistantScreenDistance,
    ringResolution: values.reflectionRingResolution,
    relativeThickness: values.reflectionRelativeDepthThickness,
    distantTolerance: values.reflectionDistantScreenDepthThreshold,
    distantOffsetBias: values.reflectionDistantScreenOffsetBias,
    traceDistance: probes.values.screenProbeMaxTraceDistance,
    maxRayIntensity: values.reflectionMaxRayIntensity,
    sampleDepthThickness: values.reflectionSampleSceneColorDepthThickness,
    sampleFacing: Math.cos(values.reflectionSampleSceneColorNormalThreshold * DEG2RAD),
    fogSkyDistance: values.reflectionMinDistanceForFoggingSky,
    temporal: values.reflectionTemporal,
    reconstruction: values.reflectionReconstruction,
    bilateral: values.reflectionBilateralFilter,
    historyFrames: values.reflectionMaxFramesAccumulated,
    clampScale: values.reflectionNeighborhoodClampScale,
    rayDirections: values.reflectionMaxRayDirections,
    historyDistance: values.reflectionHistoryDistanceThreshold,
    tonemapRange: values.reflectionDenoiserTonemapRange,
    reconstructionRadius: values.reflectionReconstructionRadius,
    bilateralRadius: values.reflectionBilateralRadius,
    bilateralSamples: values.reflectionBilateralSamples,
    disocclusionFrames: values.reflectionBilateralDisocclusionFrames,
    maxRoughness: enabled ? values.reflectionMaxRoughnessToTrace : 0,
    roughnessFade: values.reflectionRoughnessFadeLength,
    samplingBias: values.reflectionGGXSamplingBias,
  }
}

/** The settings of nothing written: every default, the screen probes' too. */
export const defaultReflections = () =>
  resolveReflections(
    resolveSettings(REFLECTION_RULES, {}),
    resolveScreenProbes(resolveSettings(SCREEN_PROBE_RULES, {})),
  )
