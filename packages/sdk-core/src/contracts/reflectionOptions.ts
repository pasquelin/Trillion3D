import { DEG2RAD } from '../../../math/src/constants.ts'
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
  type ReflectionKnobs,
  type ReflectionLevel,
} from './reflectionLevels.ts'

/**
 * The reflections: what a reflected ray may spend on its way, stage by stage — the screen first, then
 * the scene, marched through the global distance field, then the screen again for the far distance, then the
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
 * THE SCENE, marched through the global distance field: a ray the screen did not answer goes on from where
 * the screen stopped knowing it, less four voxels of the clipmap that holds that point, stepping through the
 * field's clipmaps (`../lighting/globalDistanceField.ts`) — its steps dithered by noise near a mirror — up to
 * `screenProbeMaxTraceDistance` (200 m). While the scene trace is on the field takes the sizes of rays marched through
 * it, and the options of its rays (`./globalDistanceFieldOptions.ts`) apply. Where the march meets a surface,
 * the surface's light is read in the surface cache's final lighting at the hit, on the finest page of the cards
 * (`reflectionHiResSurface`, on; off, the coarsest)
 * of the objects near it (`./surfaceCacheOptions.ts`), the page the ray's cone would have read finer being asked
 * of the cache by the feedback (`surfaceCacheFeedback`), or is the lit image where it agrees with the depth
 * (`reflectionSampleSceneColor`); a hit no card gave any light of answers nothing, and the ray goes on to the
 * probes' field. A march that meets nothing goes
 * on to the screen's far trace, then to the environment. The scene trace has one switch, the screen probes'
 * (`screenProbeSceneTraces`, `../bounce/screenProbeOptions.ts`): off, a ray goes from the screen to the sky, in
 * the reflections as in the probes. The lighting of every trace is fogged along the ray
 * (`reflectionHeightFog`) and none brings back more than `reflectionMaxRayIntensity` (40).
 *
 * THE FAR SCREEN TRACE, after the field: a ray that left the outermost clipmap looks once more at what the
 * screen shows, linearly, from where it left the clipmap up to `reflectionDistantScreenDistance` (2 000 m), in
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
 *
 * THE SKYLIGHT LEAKING of the reflections' hits: the light a hit surface takes from the sky light whatever hides it, an art
 * direction knob that keeps interiors from going fully black (`reflectionSkylightLeaking`, from 0 to 1, 0 by default: none),
 * tinted by `reflectionSkylightLeakingTintRed`, `…Green`, `…Blue` (white), as a hit surface of the average albedo
 * `reflectionSkylightLeakingAverageAlbedo` (0.25) reflects the sky light's diffuse light at its normal; added to what the scene
 * stage returns — a hit of the scene at its normal, a ray that reaches the sky at the zero normal —, before its fog and
 * under the ceiling of a ray.
 *
 * THE STATISTICS (`reflectionStatistics`, false): whether the trace counts its rays — where each ended, the steps of each march —
 * in counters read back a few images late (`ReflectionFrameMetrics`), a diagnostic that costs atomics and a readback every image.
 * Off, the kernels are compiled without the counting and nothing is read back. A switch of the kernels: read once, when the
 * session opens, as the translucent shadow switches are.
 *
 * THE FRONT LAYER of the transparents: the nearest transparent surface of a pixel is traced like an opaque one
 * (its own rays, history and filter) only where the level allows it and either the level asks for it or the
 * project does (`reflectionFrontLayer`, false by default): the reference's project setting of its high quality translucency
 * reflections, off by default and on at its cinematic level, off at its high one. Without it a transparent surface reads the
 * screen and the screen probes alone, never a ray.
 */

const METRES = 'a finite number of metres above 0'

/** The reflections' settings by field, each with the reference's default; `'ultra'` the level. */
export const REFLECTION_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choice('reflectionQuality', DEFAULT_REFLECTION_LEVEL, REFLECTION_LEVELS),
    flag('reflectionScreenTraces', true),
    count('reflectionScreenSteps', 50, 1),
    positive('reflectionRelativeDepthThickness', 0.005),
    flag('reflectionDistantScreenTraces', true),
    count('reflectionDistantScreenSteps', 16, 1),
    positive('reflectionDistantScreenDistance', 2000, METRES),
    positive('reflectionDistantScreenDepthThreshold', 2),
    number('reflectionDistantScreenOffsetBias', 0, ANY_NUMBER),
    integer('reflectionSampleSceneColor', 1, [0, 2]),
    positive('reflectionSampleSceneColorDepthThickness', 0.01),
    number('reflectionSampleSceneColorNormalThreshold', 85, [0, 180]),
    flag('reflectionHeightFog', true),
    flag('reflectionHiResSurface', true),
    positive('reflectionMinDistanceForFoggingSky', 1000, METRES),
    positive('reflectionMaxRayIntensity', 40),
    flag('reflectionTemporal', true),
    count('reflectionMaxFramesAccumulated', 12, 1),
    number('reflectionNeighborhoodClampScale', 1, ANY_NUMBER),
    count('reflectionMaxRayDirections', 1024, 1),
    positive('reflectionHistoryDistanceThreshold', 0.03),
    nonNegative('reflectionDenoiserTonemapRange', 10),
    flag('reflectionReconstruction', true),
    positive('reflectionReconstructionRadius', 8, 'a finite number of pixels above 0'),
    flag('reflectionBilateralFilter', true),
    positive('reflectionBilateralRadius', 8, 'a finite number of pixels above 0'),
    count('reflectionBilateralSamples', 4, 0),
    count('reflectionBilateralDisocclusionFrames', 2, 1),
    number('reflectionMaxRoughnessToTrace', 0.4, [0, 1]),
    positive('reflectionRoughnessFadeLength', 0.1),
    number('reflectionGGXSamplingBias', 0.1, [0, 1]),
    flag('reflectionFrontLayer', false),
    number('reflectionSkylightLeaking', 0, [0, 1]),
    nonNegative('reflectionSkylightLeakingTintRed', 1),
    nonNegative('reflectionSkylightLeakingTintGreen', 1),
    nonNegative('reflectionSkylightLeakingTintBlue', 1),
    nonNegative('reflectionSkylightLeakingAverageAlbedo', 0.25),
    flag('reflectionStatistics', false),
  ] as const))()
/** The field of one setting of the reflections. */
export type ReflectionField = keyof typeof REFLECTION_RULES
/** The reflections' settings as a host writes them, by their fields: each its value, or nothing for
 *  its default. */
export type ReflectionOptions = SettingOptions<typeof REFLECTION_RULES>
/** The values of the reflections' settings, resolved. */
export type ReflectionValues = SettingValues<typeof REFLECTION_RULES>

/** What the scene's single-layer water asks of the front layer's trace (`singleLayerWaterOptions.ts`): the side
 *  of the blocks of pixels it is traced for, across and down (`singleLayerWaterReflectionDownsample`, a block of one row with `singleLayerWaterReflectionCheckerboard`), whether its
 *  reconstruction (`singleLayerWaterReflectionReconstruction`), its temporal pass and its bilateral pass run
 *  (`singleLayerWaterReflectionDenoising`; the temporal pass of the screen technique is
 *  `singleLayerWaterReflectionTemporal`), and whether it marches the scene and looks again at the screen past it (not the screen technique's, which is
 *  the screen's march alone). */
export interface WaterFrontSettings {
  block: readonly [number, number]
  reconstruction: boolean
  temporal: boolean
  bilateral: boolean
  sceneTraces: boolean
  distantTraces: boolean
}

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
  /** Whether the transparents' front layer is traced: where the level allows it and the level or the project asks for it. */
  frontLayer: boolean
  /** The same for the front layer's trace: the side of its blocks of pixels, and whether its reconstruction,
   *  temporal and bilateral passes run. Those of the opaque trace (`block`, `reconstruction`, `temporal`,
   *  `bilateral`) unless the scene's water asks for the front layer (`WaterFrontSettings`). */
  frontBlock: readonly [number, number]
  frontReconstruction: boolean
  frontTemporal: boolean
  frontBilateral: boolean
  frontSceneTraces: boolean
  frontDistantTraces: boolean
  /** The iterations of the screen march, and of the far one. */
  screenSteps: number
  distantSteps: number
  /** Whether the screen is traced, the scene, and whether the screen looks again past the field; whether a hit
   *  the screen agrees with takes the lit image; whether the lighting is fogged along its ray. */
  screenTraces: boolean
  sceneTraces: boolean
  distantTraces: boolean
  /** Whether rays are marched through the global distance field: the level traces and the scene trace is on
   *  (the field then takes the sizes of rays marched through it, `sizeForTraces`). */
  marchesField: boolean
  sampleSceneColor: boolean
  heightFog: boolean
  /** Whether a scene hit reads the finest pages of the cards that are in the atlas, or the coarsest, always resident. */
  hiResSurface: boolean
  /** The metres a ray leaves a surface by at least, and the far trace's length. */
  surfaceBias: number
  distantDistance: number
  /** The thickness of a surface of the screen march in its depth, the far trace's slope tolerance and offset
   *  bias, the longest ray in metres, the most radiance a ray brings back. */
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
  /** The light a hit of the scene takes from the sky light's diffuse light, whatever hides it, as a share of it, by channel: the
   *  leaking, its tint and the average albedo of a hit multiplied (zero by default). */
  skylightLeak: readonly [number, number, number]
}

/** The channels of the skylight leaking a hit takes: its strength, its tint and the average albedo of the surface multiplied. */
function skylightLeakOf(values: ReflectionValues): readonly [number, number, number] {
  const strength = values.reflectionSkylightLeaking * values.reflectionSkylightLeakingAverageAlbedo
  const red = values.reflectionSkylightLeakingTintRed,
    green = values.reflectionSkylightLeakingTintGreen,
    blue = values.reflectionSkylightLeakingTintBlue
  return [strength * red, strength * green, strength * blue]
}

type FrontLayerSettings = Pick<
  ReflectionSettings,
  | 'frontLayer'
  | 'frontBlock'
  | 'frontReconstruction'
  | 'frontTemporal'
  | 'frontBilateral'
  | 'frontSceneTraces'
  | 'frontDistantTraces'
>

/** The settings of the front layer: the level's knobs, over which the water's own side and settings win. */
function frontLayerOf(
  values: ReflectionValues,
  probes: ScreenProbeSettings,
  enabled: boolean,
  knobs: ReflectionKnobs,
  water?: WaterFrontSettings,
): FrontLayerSettings {
  return {
    frontLayer:
      enabled &&
      (!!water ||
        (knobs.frontLayerAllowed && (knobs.frontLayerTraced || values.reflectionFrontLayer))),
    frontBlock: water ? water.block : [knobs.downsample, knobs.downsample],
    frontReconstruction: values.reflectionReconstruction && (water?.reconstruction ?? true),
    frontTemporal: values.reflectionTemporal && (water?.temporal ?? true),
    frontBilateral: values.reflectionBilateralFilter && (water?.bilateral ?? true),
    frontSceneTraces: probes.values.screenProbeSceneTraces && (water?.sceneTraces ?? true),
    frontDistantTraces:
      values.reflectionDistantScreenTraces &&
      values.reflectionScreenTraces &&
      (water?.distantTraces ?? true),
  }
}

/**
 * The reflections' settings `values` over the screen probes' `probes` — the scene trace's switch, the bias a ray
 * leaves a surface by and the longest ray are the reference's shared ones, the probes' own —: the numbers the
 * trace reads. The one derivation of the level's row: a level that traces holds its block, its reconstruction's
 * samples and weight; `'off'` casts no ray (a lobe rougher than zero traces nothing), the default row's values
 * standing in the numbers the view still reads. `water`: the scene holds single-layer water whose reflection
 * the front layer carries (`singleLayerWaterReflection`): the front layer is then traced at every level that
 * traces, whatever `reflectionFrontLayer` says, in blocks of the water's own side, with the
 * reconstruction, the denoising and the scene trace the water's settings leave on (`frontBlock`,
 * `frontReconstruction`, `frontTemporal`, `frontBilateral`, `frontSceneTraces`, `frontDistantTraces`).
 */
export function resolveReflections(
  values: ReflectionValues,
  probes: ScreenProbeSettings,
  water?: WaterFrontSettings,
): ReflectionSettings {
  const level = values.reflectionQuality
  const enabled = level !== 'off'
  const knobs = REFLECTION_LEVEL_KNOBS[enabled ? level : DEFAULT_REFLECTION_LEVEL]
  const screenTraces = values.reflectionScreenTraces
  const sample = values.reflectionSampleSceneColor
  return {
    level,
    enabled,
    block: knobs.downsample,
    reconstructionSamples: knobs.reconstructionSamples,
    reconstructionMinWeight: knobs.reconstructionMinWeight,
    ...frontLayerOf(values, probes, enabled, knobs, water),
    screenSteps: values.reflectionScreenSteps,
    distantSteps: values.reflectionDistantScreenSteps,
    screenTraces,
    sceneTraces: probes.values.screenProbeSceneTraces,
    marchesField: enabled && probes.values.screenProbeSceneTraces,
    distantTraces: values.reflectionDistantScreenTraces && screenTraces,
    sampleSceneColor: sample === 2 || (sample === 1 && screenTraces),
    heightFog: values.reflectionHeightFog,
    hiResSurface: values.reflectionHiResSurface,
    surfaceBias: probes.values.screenProbeSurfaceBias,
    distantDistance: values.reflectionDistantScreenDistance,
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
    skylightLeak: skylightLeakOf(values),
  }
}

/** The settings of nothing written: every default, the screen probes' too. */
export const defaultReflections = () =>
  resolveReflections(
    resolveSettings(REFLECTION_RULES, {}),
    resolveScreenProbes(resolveSettings(SCREEN_PROBE_RULES, {})),
  )
