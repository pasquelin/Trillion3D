import { DEG2RAD } from '../../../math/src/constants.ts'
import { CENTIMETRES_PER_METRE } from '../page/format.ts'
import {
  resolveScreenProbes,
  SCREEN_PROBE_RULES,
  type ScreenProbeSettings,
} from '../bounce/screenProbeOptions.ts'
import {
  ANY_NUMBER,
  atLeast,
  INT32_RANGE,
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
  TRACED_TRANSLUCENCY_RULES,
  type TracedTranslucencyValues,
} from './tracedTranslucencyOptions.ts'
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
 * surface (`reflectionScreenTraces`), `reflectionScreenSteps` iterations at most (50), or until no more than
 * `reflectionScreenMinimumOccupancy` lanes of its subgroup are still marching (0: never), a surface being as thick
 * as `reflectionRelativeDepthThickness` (0.5 %) of its depth. The march is strict: a ray that passes behind a
 * surface gives the screen up, one that spends its iterations has hit nothing, and either hands the ray over to the
 * scene where it stopped knowing. A hit near the border of the image, or of the last, is answered by the screen by chance
 * alone, and a hit whose place in the last image's depth is not the depth it is expected at there, within
 * `reflectionHistoryDepthTestRelativeThickness` (0.5 %) of the depth, was not visible then: the ray goes on to the scene from before it. The hit's place in
 * the last image follows the motion of the surface it lands on.
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
 * (`reflectionHeightFog`) and none brings back more than `reflectionMaxRayIntensity` (40) in the display's white, the radiance times the
 * image's pre-exposure.
 *
 * THE FAR SCREEN TRACE, after the field: a ray that left the outermost clipmap looks once more at what the
 * screen shows, linearly, from where it left the clipmap up to `reflectionDistantScreenDistance` (2 000 m), in
 * `reflectionDistantScreenSteps` (16) steps jittered by noise and `reflectionDistantScreenOffsetBias` (0), a
 * surface within `reflectionDistantScreenDepthThreshold` (2) of the slope of the ray hit, before the
 * environment answers; `reflectionDistantScreenTraces` turns it off.
 *
 * THE RADIANCE CACHE (`reflectionRadianceCache`, false): the screen probes' radiance cache (`screenProbeRadianceCache`) read for the rough
 * reflections. A pixel rougher than `reflectionRadianceCacheMinRoughness` (0.2, blue noise of `reflectionRadianceCacheRoughnessFadeLength` (0.05)
 * added to its roughness) whose point the cache covers casts a ray shortened from `reflectionRadianceCacheMaxTraceDistance` (5000 cm) at that
 * roughness to `reflectionRadianceCacheMinTraceDistance` (1000 cm) at `reflectionRadianceCacheMaxRoughness` (0.35), never under the nearest the cache
 * asks to be traced; a ray of those that meets nothing in that distance takes the light the cache holds along it instead of going on to the far
 * trace and the environment (`reflectionRadianceCacheStochasticInterpolation`, true: one probe of the eight, drawn by the interpolation weights, as
 * the reference does; false: the eight, weighed), read through a sphere round each probe scaled by `reflectionRadianceCacheReprojectionRadiusScale` (10).
 *
 * THE SCENE THROUGH ITS TRIANGLES (`reflectionHardwareRayTracing`, on): where the scene has acceleration structures, the rays the screen missed go through the scene's triangles (`../lighting/rays/sceneTrace/`) instead of
 * being marched through the field: from `reflectionHardwareRayTracingBias` (0.1 cm) along the ray, or from where the screen
 * stopped knowing it less `hardwareRayTracingPullbackBias` (the screen probes' shared one, 8 cm), off the surface by `reflectionHardwareRayTracingNormalBias`
 * (0.1 cm) along its normal as far as the ray leans on it, to the longest ray, culling the back faces of the primitives that are not
 * two-sided and passing the translucent ones; the surface cache is read at the triangle it meets, with the cone of the ray, the
 * hit bringing no light where no card gives any, and a trace that stopped after `surfaceCacheHardwareRayTracingMaxIterations`
 * triangles having met nothing being a black hit (one that met a triangle keeps its hit's light). A ray that meets nothing goes on as a march's would: to the screen's far trace, which
 * begins where the ray leaves the scene trace's culling radius, then to the environment. Off, or where the scene has
 * no acceleration structures, the rays are marched through the global distance field.
 *
 * THE FIRST-PERSON STAND-INS (`reflectionHardwareRayTracingFirstPersonMinimumHitDistance`, 4 cm): the objects that stand, in the world,
 * for a first-person one are invisible to the camera, so the screen can miss them. A ray the screen missed, where one lies in its way, is
 * handed to the scene trace where it enters the bounding sphere of all the stand-ins, at least that far from its surface, so that the
 * scene trace has a chance to meet them while the screen still covers the distance that keeps the two copies of a mesh from meeting each other.
 *
 * THE DENOISER: a pixel resolves its reflection from the rays round it (`reflectionReconstruction`, over
 * `reflectionReconstructionRadius` pixels, weighing them on the roughness times `reflectionReconstructionRoughnessScale`), accumulates it over `reflectionMaxFramesAccumulated` images under a
 * clamp (`reflectionTemporal`, `reflectionNeighborhoodClampScale`, `reflectionHistoryDistanceThreshold`) and filters
 * it last where its history is short (`reflectionBilateralFilter`, over `reflectionBilateralRadius` pixels, `reflectionBilateralSamples`
 * neighbours, `reflectionBilateralDisocclusionFrames` images of boost and the depth weight `reflectionBilateralDepthWeightScale`); a lobe rougher than
 * `reflectionMaxRoughnessToTrace` casts no ray (a pixel of the subsurface or two-sided foliage models, past
 * `reflectionMaxRoughnessToTraceForFoliage`, −1 by default: the level's row), the probes' field answering it, over a fade of
 * `reflectionRoughnessFadeLength`.
 *
 * THE RAYS' DENSITY: the level's block of pixels a ray is traced for (`reflectionQuality`) is doubled by a quality
 * scale at the lowest end (`reflectionQualityScale`, at most 0.25: 2 × 2 pixels a ray) and, where the checkerboard is on
 * (`reflectionDownsampleCheckerboard`), kept one pixel high (2 × 1); the same scale, over 1, raises the neighbours' rays the
 * reconstruction reads (the level's count times the scale, at most 64). A global bias on every surface's roughness
 * (`reflectionSmoothBias`, 0: none) pulls the rougher lobes toward a mirror, a smoothstep up to the bias.
 *
 * THE LOOK of the light a surface reflects, two art-direction knobs of the final composite (`reflectionContrast`, from 0.001 to 1, 1 by default;
 * `reflectionSpecularScale`, 0 or more, 1 by default: neither is physically correct, both are best left at 1): the light a pixel reflects, the rays' answer
 * and the rough light of the screen probes blended, is raised to the contrast about the mid grey (0.18, so that the overall exposure does not change)
 * and multiplied by the scale, before the environment BRDF weighs it; a pixel with a clear coat does it to its coat's light and to the light of its base lobe apart.
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

/** The most neighbours the bilateral filter reads, whatever the setting asks. */
const BILATERAL_SAMPLES_MAX = 1024
const METRES_NOTE = 'a finite number of metres above 0'
const CENTIMETRES_NOTE = 'a finite number of centimetres of at least 0'
/** The least the first-person stand-ins' hand-off distance is held to, in centimetres: a zero distance would hand the ray off inside the surface it left. */
const LEAST_FIRST_PERSON_HIT_DISTANCE = 1e-8

/** The reflections' settings by field, each with the reference's default; `'ultra'` the level. */
export const REFLECTION_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choice('reflectionQuality', DEFAULT_REFLECTION_LEVEL, REFLECTION_LEVELS),
    flag('reflectionScreenTraces', true),
    count('reflectionScreenSteps', 50, 1),
    count('reflectionScreenMinimumOccupancy', 0, 0),
    positive('reflectionRelativeDepthThickness', 0.005),
    positive('reflectionHistoryDepthTestRelativeThickness', 0.005),
    flag('reflectionDistantScreenTraces', true),
    count('reflectionDistantScreenSteps', 16, 1),
    positive('reflectionDistantScreenDistance', 2000, METRES_NOTE),
    positive('reflectionDistantScreenDepthThreshold', 2),
    number('reflectionDistantScreenOffsetBias', 0, ANY_NUMBER),
    flag('reflectionRadianceCache', false),
    flag('reflectionRadianceCacheStochasticInterpolation', true),
    number('reflectionRadianceCacheMinRoughness', 0.2, [0, 1]),
    number('reflectionRadianceCacheMaxRoughness', 0.35, [0, 1]),
    nonNegative('reflectionRadianceCacheMinTraceDistance', 1000, CENTIMETRES_NOTE),
    nonNegative('reflectionRadianceCacheMaxTraceDistance', 5000, CENTIMETRES_NOTE),
    number('reflectionRadianceCacheRoughnessFadeLength', 0.05, [0, 1]),
    number('reflectionRadianceCacheReprojectionRadiusScale', 10, [1, 100000]),
    integer('reflectionSampleSceneColor', 1, [0, 2]),
    positive('reflectionSampleSceneColorDepthThickness', 0.01),
    number('reflectionSampleSceneColorNormalThreshold', 85, [0, 180]),
    flag('reflectionHeightFog', true),
    flag('reflectionHiResSurface', true),
    flag('reflectionHardwareRayTracing', true),
    nonNegative('reflectionHardwareRayTracingBias', 0.1, CENTIMETRES_NOTE),
    nonNegative('reflectionHardwareRayTracingNormalBias', 0.1, CENTIMETRES_NOTE),
    nonNegative('reflectionHardwareRayTracingFirstPersonMinimumHitDistance', 4, CENTIMETRES_NOTE),
    positive('reflectionMinDistanceForFoggingSky', 1000, METRES_NOTE),
    positive('reflectionMaxRayIntensity', 40),
    flag('reflectionTemporal', true),
    count('reflectionMaxFramesAccumulated', 12, 1),
    number('reflectionNeighborhoodClampScale', 1, ANY_NUMBER),
    count('reflectionMaxRayDirections', 1024, 1),
    integer('reflectionFixedStateFrameIndex', -1, [-1, INT32_RANGE[1]]),
    positive('reflectionHistoryDistanceThreshold', 0.03),
    nonNegative('reflectionDenoiserTonemapRange', 10),
    flag('reflectionDownsampleCheckerboard', false),
    number('reflectionQualityScale', 1, atLeast(0.25)),
    nonNegative('reflectionSmoothBias', 0),
    flag('reflectionReconstruction', true),
    positive('reflectionReconstructionRadius', 8, 'a finite number of pixels above 0'),
    positive('reflectionReconstructionRoughnessScale', 1),
    flag('reflectionBilateralFilter', true),
    positive('reflectionBilateralRadius', 8, 'a finite number of pixels above 0'),
    count('reflectionBilateralSamples', 4, 0),
    count('reflectionBilateralDisocclusionFrames', 2, 0),
    nonNegative('reflectionBilateralDepthWeightScale', 10000),
    number('reflectionMaxRoughnessToTrace', 0.4, [0, 1]),
    number('reflectionMaxRoughnessToTraceForFoliage', -1, [-1, 1]),
    positive('reflectionRoughnessFadeLength', 0.1),
    number('reflectionGGXSamplingBias', 0.1, [0, 1]),
    number('reflectionContrast', 1, [0.001, 1]),
    nonNegative('reflectionSpecularScale', 1),
    flag('reflectionFrontLayer', false),
    number('reflectionSkylightLeaking', 0, [0, 1]),
    nonNegative('reflectionSkylightLeakingTintRed', 1),
    nonNegative('reflectionSkylightLeakingTintGreen', 1),
    nonNegative('reflectionSkylightLeakingTintBlue', 1),
    nonNegative('reflectionSkylightLeakingAverageAlbedo', 0.25),
    flag('reflectionStatistics', false),
    ...TRACED_TRANSLUCENCY_RULES,
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
  /** The traced translucency's settings, resolved (`tracedTranslucencyOptions.ts`). */
  traced: TracedTranslucencyValues
  /** The level the settings were resolved at, and whether the view traces at all: false at `'off'`. */
  level: ReflectionLevel
  enabled: boolean
  /** The level's row: the blocks a ray is traced for, across (`block`) and down (`blockY`: the same unless the
   *  checkerboard keeps it at one pixel), the neighbours' rays a pixel reads at most, and the
   *  least share of its own weight they weigh. */
  block: number
  blockY: number
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
  /** The iterations of the screen march, and of the far one; the lanes of a subgroup that must still be marching for the screen march to go on
   *  (0: no such test). */
  screenSteps: number
  screenMinimumOccupancy: number
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
  /** Whether the rays the screen missed go through the scene's triangles where the scene has acceleration structures, and, in metres, the least
   *  a ray goes along itself, how far the ray's start is moved off its surface along the normal as far as it leans on it, and how far the start
   *  the screen stopped knowing it at is pulled back. */
  hardwareTraces: boolean
  hardwareBias: number
  hardwareNormalBias: number
  hardwarePullbackBias: number
  /** The least distance, in metres, at which a ray the screen missed is handed to the scene trace where it meets the sphere that holds the
   *  stand-ins of the first-person objects. */
  firstPersonMinimumHitDistance: number
  /** The radiance cache the rough reflections read (`reflectionRadianceCache` with the screen probes' cache on): the roughness the rays begin to be shortened
   *  at and the one they are shortest at, the roughness noise's width, the longest and the shortest a shortened ray goes in metres (the shortest held to the
   *  longest, the longest to the view's longest ray), whether the probes are drawn stochastically, and the scale of the sphere they are read through. */
  radianceCache: boolean
  radianceCacheStochastic: boolean
  radianceCacheMinRoughness: number
  radianceCacheMaxRoughness: number
  radianceCacheFade: number
  radianceCacheMaxDistance: number
  radianceCacheMinDistance: number
  radianceCacheRadiusScale: number
  /** The metres a ray leaves a surface by at least, and the far trace's length. */
  surfaceBias: number
  distantDistance: number
  /** The thickness of a surface of the screen march in its depth, the thickness a hit's place in the last image's depth may differ
   *  from the depth the hit is expected at by, the far trace's slope tolerance and offset
   *  bias, the longest ray in metres, the most radiance a ray brings back. */
  relativeThickness: number
  historyDepthThickness: number
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
   *  filter's radius, taps (held to 1024), disocclusion frames and depth weight scale, the roughness past which a lobe casts no ray,
   *  the fade to it and the sampling's bias. */
  temporal: boolean
  reconstruction: boolean
  bilateral: boolean
  historyFrames: number
  clampScale: number
  rayDirections: number
  /** The frame index the view's noise is held at, for debugging (`reflectionFixedStateFrameIndex`): from 0 on, the index of every pass of the reflections; -1, none. */
  fixedStateFrameIndex: number
  historyDistance: number
  tonemapRange: number
  reconstructionRadius: number
  /** The scale of the roughness the reconstruction weighs the neighbours' rays on. */
  reconstructionRoughnessScale: number
  bilateralRadius: number
  bilateralSamples: number
  /** The images of history under which the bilateral filter boosts itself (the setting, held to the images a history holds), and
   *  the scale of its depth weight. */
  disocclusionFrames: number
  bilateralDepthScale: number
  maxRoughness: number
  /** The same bar for the pixels of the thin transmission (the subsurface and two-sided foliage models). */
  maxRoughnessFoliage: number
  /** The roughness past which the screen probes read the rough specular of those pixels no more: the probes' setting
   *  (`screenProbeMaxRoughnessToEvaluateRoughSpecularForFoliage`) where it names one, else the level's row, which sets it with the bar above. */
  maxRoughnessEvaluateFoliage: number
  roughnessFade: number
  samplingBias: number
  /** The look of the light a pixel reflects: the contrast it is raised to about the mid grey and the scale it is multiplied by, before the environment BRDF weighs it. */
  contrast: number
  specularScale: number
  /** The global bias that pulls every surface's roughness toward a mirror (0: none). */
  smoothBias: number
  /** The share of the sky light's diffuse light that leaks onto a hit of the scene, whatever hides it, by channel: the leaking times
   *  its tint (zero by default). The screen probes' rays take it as it is; the reflections multiply it by `skylightLeakAlbedo`. */
  skylightLeakColor: readonly [number, number, number]
  /** The albedo a hit surface is taken to have when it reflects the leaking sky light: it scales `skylightLeakColor` in the reflections only. */
  skylightLeakAlbedo: number
}

type Density = ReturnType<typeof densityOf>

/** The blocks of pixels a ray is traced for, across and down, and the neighbours' rays the reconstruction reads at most: the level's
 *  row, its block doubled (two at most) by a quality scale of 0.25 or less, its height kept at one pixel by the checkerboard,
 *  its count raised by the scale, from the level's own up to 64. */
function densityOf(values: ReflectionValues, knobs: ReflectionKnobs) {
  const scale = values.reflectionQualityScale
  const block = Math.min(Math.max(knobs.downsample * (scale <= 0.25 ? 2 : 1), 1), 2)
  return {
    block,
    blockY: values.reflectionDownsampleCheckerboard ? 1 : block,
    samples: Math.min(
      Math.max(Math.round(scale * knobs.reconstructionSamples), knobs.reconstructionSamples),
      64,
    ),
  }
}

/** The channels of the skylight leaking a hit takes: its strength times its tint. */
function skylightLeakColorOf(values: ReflectionValues): readonly [number, number, number] {
  const strength = values.reflectionSkylightLeaking
  return [
    strength * values.reflectionSkylightLeakingTintRed,
    strength * values.reflectionSkylightLeakingTintGreen,
    strength * values.reflectionSkylightLeakingTintBlue,
  ]
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

/** The settings of the front layer: the level's knobs, over which the water's own side and settings win. Its blocks are the opaque
 *  trace's (`density`): the front layer is traced at the factor of the opaque pass, its quality scale and its checkerboard included. */
function frontLayerOf(
  values: ReflectionValues,
  probes: ScreenProbeSettings,
  enabled: boolean,
  knobs: ReflectionKnobs,
  density: Density,
  water?: WaterFrontSettings,
): FrontLayerSettings {
  return {
    frontLayer:
      enabled &&
      (!!water ||
        (knobs.frontLayerAllowed && (knobs.frontLayerTraced || values.reflectionFrontLayer))),
    frontBlock: water ? water.block : [density.block, density.blockY],
    frontReconstruction: values.reflectionReconstruction && (water?.reconstruction ?? true),
    frontTemporal: values.reflectionTemporal && (water?.temporal ?? true),
    // The translucent surfaces' denoiser runs its spatial filter whatever its temporal pass does (LumenReflections.cpp:2247-2248), unlike the opaque one's.
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
  const density = densityOf(values, knobs)
  return {
    traced: values,
    level,
    enabled,
    block: density.block,
    blockY: density.blockY,
    reconstructionSamples: density.samples,
    reconstructionMinWeight: knobs.reconstructionMinWeight,
    ...frontLayerOf(values, probes, enabled, knobs, density, water),
    ...marchOf(values, probes),
    marchesField: enabled && probes.values.screenProbeSceneTraces,
    ...denoiserOf(values),
    ...lobeOf(values, probes, knobs, enabled),
  }
}

/** The settings of the rays' march: the screen's, the scene's and the far trace's budgets and tolerances, what a hit takes of the lit
 *  image, the hardware rays' biases (in metres) and the fog and the ceiling a ray's radiance is held to. */
function marchOf(values: ReflectionValues, probes: ScreenProbeSettings) {
  const screenTraces = values.reflectionScreenTraces
  const sample = values.reflectionSampleSceneColor
  const cache = radianceCacheOf(values, probes)
  return {
    screenSteps: values.reflectionScreenSteps,
    screenMinimumOccupancy: values.reflectionScreenMinimumOccupancy,
    distantSteps: values.reflectionDistantScreenSteps,
    screenTraces,
    sceneTraces: probes.values.screenProbeSceneTraces,
    // The opaque surface's rays read the cache instead of the far trace.
    distantTraces: values.reflectionDistantScreenTraces && screenTraces && !cache.radianceCache,
    sampleSceneColor: sample === 2 || (sample === 1 && screenTraces),
    heightFog: values.reflectionHeightFog,
    hiResSurface: values.reflectionHiResSurface,
    hardwareTraces: values.reflectionHardwareRayTracing,
    hardwareBias: values.reflectionHardwareRayTracingBias / CENTIMETRES_PER_METRE,
    hardwareNormalBias: values.reflectionHardwareRayTracingNormalBias / CENTIMETRES_PER_METRE,
    hardwarePullbackBias: probes.values.hardwareRayTracingPullbackBias,
    firstPersonMinimumHitDistance:
      Math.max(
        values.reflectionHardwareRayTracingFirstPersonMinimumHitDistance,
        LEAST_FIRST_PERSON_HIT_DISTANCE,
      ) / CENTIMETRES_PER_METRE,
    surfaceBias: probes.values.screenProbeSurfaceBias,
    distantDistance: values.reflectionDistantScreenDistance,
    relativeThickness: values.reflectionRelativeDepthThickness,
    historyDepthThickness: values.reflectionHistoryDepthTestRelativeThickness,
    distantTolerance: values.reflectionDistantScreenDepthThreshold,
    distantOffsetBias: values.reflectionDistantScreenOffsetBias,
    ...cache,
    traceDistance: probes.values.screenProbeMaxTraceDistance,
    maxRayIntensity: values.reflectionMaxRayIntensity,
    sampleDepthThickness: values.reflectionSampleSceneColorDepthThickness,
    sampleFacing: Math.cos(values.reflectionSampleSceneColorNormalThreshold * DEG2RAD),
    fogSkyDistance: values.reflectionMinDistanceForFoggingSky,
  }
}

/** The radiance cache the rough reflections read, the reference's holds on its numbers: the roughness it ends at not under the one it begins at, the
 *  longest ray not past the view's longest, the shortest not past the longest. */
function radianceCacheOf(values: ReflectionValues, probes: ScreenProbeSettings) {
  const least = values.reflectionRadianceCacheMinRoughness
  const longest = Math.min(
    values.reflectionRadianceCacheMaxTraceDistance / CENTIMETRES_PER_METRE,
    probes.values.screenProbeMaxTraceDistance,
  )
  return {
    radianceCache: values.reflectionRadianceCache && probes.radianceCache,
    radianceCacheStochastic: values.reflectionRadianceCacheStochasticInterpolation,
    radianceCacheMinRoughness: least,
    radianceCacheMaxRoughness: Math.max(values.reflectionRadianceCacheMaxRoughness, least),
    radianceCacheFade: values.reflectionRadianceCacheRoughnessFadeLength,
    radianceCacheMaxDistance: longest,
    radianceCacheMinDistance: Math.min(
      values.reflectionRadianceCacheMinTraceDistance / CENTIMETRES_PER_METRE,
      longest,
    ),
    radianceCacheRadiusScale: values.reflectionRadianceCacheReprojectionRadiusScale,
  }
}

/** The settings of the denoiser: its three passes, the history it keeps and the radii, taps and weights of its filters. */
function denoiserOf(values: ReflectionValues) {
  return {
    temporal: values.reflectionTemporal,
    reconstruction: values.reflectionReconstruction,
    bilateral: values.reflectionTemporal && values.reflectionBilateralFilter,
    historyFrames: values.reflectionMaxFramesAccumulated,
    clampScale: values.reflectionNeighborhoodClampScale,
    rayDirections: values.reflectionMaxRayDirections,
    fixedStateFrameIndex: values.reflectionFixedStateFrameIndex,
    historyDistance: values.reflectionHistoryDistanceThreshold,
    tonemapRange: values.reflectionDenoiserTonemapRange,
    reconstructionRadius: values.reflectionReconstructionRadius,
    reconstructionRoughnessScale: values.reflectionReconstructionRoughnessScale,
    bilateralRadius: values.reflectionBilateralRadius,
    bilateralSamples: Math.min(values.reflectionBilateralSamples, BILATERAL_SAMPLES_MAX),
    disocclusionFrames: Math.min(
      values.reflectionBilateralDisocclusionFrames,
      values.reflectionMaxFramesAccumulated,
    ),
    bilateralDepthScale: values.reflectionBilateralDepthWeightScale,
  }
}

/** The settings of the lobes a ray is cast for: the roughness past which one casts none (the foliage's bar a setting names, else the level's
 *  row), the fade to it, the sampling's and the smooth bias and the skylight leaking. */
function lobeOf(
  values: ReflectionValues,
  probes: ScreenProbeSettings,
  knobs: ReflectionKnobs,
  enabled: boolean,
) {
  const foliage = values.reflectionMaxRoughnessToTraceForFoliage
  const evaluated = probes.values.screenProbeMaxRoughnessToEvaluateRoughSpecularForFoliage
  return {
    maxRoughness: enabled ? values.reflectionMaxRoughnessToTrace : 0,
    maxRoughnessFoliage: enabled ? (foliage >= 0 ? foliage : knobs.maxRoughnessFoliage) : 0,
    maxRoughnessEvaluateFoliage: evaluated >= 0 ? evaluated : knobs.maxRoughnessEvaluateFoliage,
    // Held to a thousandth up to one, as the width it is divided by.
    roughnessFade: Math.min(Math.max(values.reflectionRoughnessFadeLength, 0.001), 1),
    samplingBias: values.reflectionGGXSamplingBias,
    contrast: values.reflectionContrast,
    specularScale: values.reflectionSpecularScale,
    smoothBias: values.reflectionSmoothBias,
    skylightLeakColor: skylightLeakColorOf(values),
    skylightLeakAlbedo: values.reflectionSkylightLeakingAverageAlbedo,
  }
}

/** The settings of nothing written: every default, the screen probes' too. */
export const defaultReflections = () =>
  resolveReflections(
    resolveSettings(REFLECTION_RULES, {}),
    resolveScreenProbes(resolveSettings(SCREEN_PROBE_RULES, {})),
  )
