import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_PROBE_QUEUE, BOUNCE_SETTINGS, resolveProbesPerFrame } from './contracts.ts'
import {
  DEFAULT_SCREEN_PROBE_LEVEL,
  SCREEN_PROBE_LEVEL_KNOBS,
  SCREEN_PROBE_PRESET_LEVELS,
} from './screenProbeLevels.ts'
import { screenProbeSettings } from './screenProbeOptions.fixture.ts'
import {
  REFLECTION_RULES,
  REFLECTION_TESTS_PER_STEP,
  REFLECTION_WORK_PER_STEP,
  resolveReflections,
} from '../contracts/reflectionOptions.ts'
import { resolveSettings } from '../contracts/settingRules.ts'

test('a frame queues as many probes as the ray ceiling holds, and no more', () => {
  const { raysPerProbe, raysPerFrame } = BOUNCE_SETTINGS
  assert.ok(Number.isInteger(BOUNCE_PROBE_QUEUE) && BOUNCE_PROBE_QUEUE >= 1)
  assert.ok(BOUNCE_PROBE_QUEUE * raysPerProbe <= raysPerFrame, 'within the ceiling')
  assert.ok((BOUNCE_PROBE_QUEUE + 1) * raysPerProbe > raysPerFrame, 'one more would pass it')
})

test('the probes a frame traces: the default when none is asked, a whole count within the queue otherwise', () => {
  assert.equal(resolveProbesPerFrame(undefined), BOUNCE_SETTINGS.probesPerFrame)
  assert.ok(BOUNCE_SETTINGS.probesPerFrame <= BOUNCE_PROBE_QUEUE)
  assert.equal(resolveProbesPerFrame(1), 1)
  assert.equal(resolveProbesPerFrame(BOUNCE_PROBE_QUEUE), BOUNCE_PROBE_QUEUE)
  for (const asked of [0, -3, 1.5, NaN, Infinity, BOUNCE_PROBE_QUEUE + 1])
    assert.throws(() => resolveProbesPerFrame(asked), RangeError, `${asked}`)
})

test('the screen probes default to their ultra level with every pass on, and a level holds its own row', () => {
  assert.equal(DEFAULT_SCREEN_PROBE_LEVEL, 'ultra')
  const settings = screenProbeSettings()
  const { values } = settings
  assert.deepEqual(
    [
      settings.level,
      settings.enabled,
      settings.casts,
      settings.downsampleFactor,
      settings.adaptiveProbes,
    ],
    ['ultra', true, true, 16, 8],
  )
  assert.deepEqual(
    [settings.tracingResolution, settings.gatherResolution, settings.irradianceFormat],
    [8, 8, 'sh3'],
  )
  assert.deepEqual(
    [
      values.screenProbeAdaptiveFraction,
      settings.spatialFilterPasses,
      values.screenProbeMaxRayIntensity,
    ],
    [0.5, 3, 10],
  )
  assert.deepEqual(
    [
      values.screenProbeScreenTraces,
      values.screenProbeImportanceSampling,
      values.screenProbeTemporal,
      settings.occlusion,
      values.screenProbeMaterialAO,
      values.screenProbeOcclusionTemporal,
    ],
    [true, true, true, true, true, true],
  )
  assert.deepEqual(
    [
      values.screenProbeSceneTraces,
      settings.meshTraces,
      values.screenProbeMeshTraceDistance,
      values.screenProbeMeshTraceEndDistance,
      values.screenProbeMaxTraceDistance,
    ],
    [true, false, 1.8, 40, 200],
  )
  assert.deepEqual(
    [
      values.screenProbeSurfaceBias,
      values.screenProbeMinTraceDistance,
      values.screenProbeHistoryDistanceThreshold,
      values.screenProbeRelativeSpeedThreshold,
    ],
    [0.05, 0, 0.01, 0.005],
  )
  assert.deepEqual(
    [
      settings.fastUpdateInverseFraction,
      values.screenProbeMaxFastUpdate,
      values.screenProbeFastUpdateClamp,
    ],
    [10, 0.9, false],
  )
  assert.deepEqual(
    [
      settings.importanceLighting,
      values.screenProbeProbeRadianceHistory,
      values.screenProbeMinPdfToTrace,
      values.screenProbeSpatialFilterPositionWeightScale,
      values.screenProbeSpatialFilterMaxHitAngle,
    ],
    [true, true, 0.1, 1000, 10],
  )
  assert.deepEqual(
    [
      values.screenProbeDisocclusionMaxFrames,
      values.screenProbeDisocclusionFraction,
      values.screenProbeHistoryDepthTestThickness,
      values.screenProbeRelativeDepthThickness,
      values.screenProbeMaxIterations,
    ],
    [4, 0.4, 0.005, 0.02, 50],
  )
  // The reference's own defaults of the interpolation and the occlusion's search, units of the engine.
  assert.deepEqual(
    [
      values.screenProbeInterpolationDepthWeight,
      values.screenProbeInterpolationDepthWeightFallback,
      values.screenProbeOcclusionSteps,
      values.screenProbeOcclusionForegroundFraction,
      values.screenProbeOcclusionMaxAlbedo,
      values.screenProbeOcclusionClampScale,
      settings.occlusionSlices,
    ],
    [1, 0.1, 3, 0.3, 0.5, 1, 2],
  )
})

test('each level holds its own row of the table, the detail trace is a switch over a level that allows it, and true and false are the default level and off', () => {
  for (const level of ['high', 'ultra', 'cinematic'] as const) {
    const row = SCREEN_PROBE_LEVEL_KNOBS[level]
    const at = screenProbeSettings({ screenProbes: level })
    assert.deepEqual(
      [at.downsampleFactor, at.adaptiveProbes, at.tracingResolution, at.irradianceFormat],
      [row.downsampleFactor, row.adaptiveProbes, row.tracingResolution, row.irradianceFormat],
      level,
    )
    assert.deepEqual(
      [at.stochasticInterpolation, at.occlusionSlices, at.bentNormal, at.casts],
      [row.stochasticInterpolation, row.occlusionSlices, row.bentNormal, true],
      level,
    )
  }
  assert.deepEqual(
    (['high', 'ultra', 'cinematic'] as const).map(
      (level) => screenProbeSettings({ screenProbes: level }).downsampleFactor,
    ),
    [32, 16, 8],
  )
  // The second level of the reference holds an occlusion row of its own and casts no probe; the first lights nothing.
  const low = screenProbeSettings({ screenProbes: 'low' })
  assert.deepEqual(
    [
      low.casts,
      low.enabled,
      low.occlusionSlices,
      low.occlusionDownsample,
      low.occlusionForegroundPower,
    ],
    [false, true, 1, 1, 1.5],
  )
  assert.deepEqual(
    [
      screenProbeSettings({ screenProbes: 'off' }).enabled,
      screenProbeSettings({ screenProbes: 'off' }).casts,
    ],
    [false, false],
  )
  // The level is read as the anti-aliasing's is: true the default level, false off.
  assert.equal(screenProbeSettings({ screenProbes: true }).level, DEFAULT_SCREEN_PROBE_LEVEL)
  assert.deepEqual(
    [
      screenProbeSettings({ screenProbes: false }).level,
      screenProbeSettings({ screenProbes: false }).enabled,
    ],
    ['off', false],
  )
  // The presets below the top write the levels the reference's scalability levels run: the lowest lights nothing, its bounce off too.
  assert.deepEqual(
    Object.values(SCREEN_PROBE_PRESET_LEVELS).map((preset) => preset.screenProbes),
    ['off', 'low', 'high'],
  )
  assert.equal(SCREEN_PROBE_PRESET_LEVELS.smooth.bounce, false)
  // The detail trace is a switch, off, over a level that allows it: the high level never does.
  const detail = (screenProbes: 'high' | 'ultra' | 'cinematic') =>
    screenProbeSettings({ screenProbes, screenProbeMeshTraces: true }).meshTraces
  assert.deepEqual([detail('high'), detail('ultra'), detail('cinematic')], [false, true, true])
  assert.equal(screenProbeSettings({ screenProbes: 'cinematic' }).meshTraces, false)
})

test('the quality scales the rays and the tile, the update speed the history, each as the reference truncates and rounds it', () => {
  assert.equal(screenProbeSettings({ screenProbeQuality: 4 }).tracingResolution, 16)
  assert.equal(screenProbeSettings({ screenProbeQuality: 100 }).tracingResolution, 16)
  assert.equal(screenProbeSettings({ screenProbeQuality: 0.05 }).tracingResolution, 4)
  // The product of the square root of the quality and the rays is truncated, then rounded up to a power of two: 8.39 is 8 rays
  // a side, not 16, and 4.38 is 4, not 8.
  assert.equal(screenProbeSettings({ screenProbeQuality: 1.1 }).tracingResolution, 8)
  assert.equal(screenProbeSettings({ screenProbeQuality: 0.3 }).tracingResolution, 4)
  assert.equal(screenProbeSettings({ screenProbeQuality: 1.3 }).tracingResolution, 16)
  assert.equal(screenProbeSettings({ screenProbeQuality: 5.9 }).downsampleFactor, 16)
  assert.equal(screenProbeSettings({ screenProbeQuality: 6 }).downsampleFactor, 8)
  assert.deepEqual(
    [
      screenProbeSettings().values.screenProbeMaxRayDirections,
      screenProbeSettings({ screenProbeMaxRayDirections: 3 }).values.screenProbeMaxRayDirections,
    ],
    [8, 3],
  )
  assert.equal(screenProbeSettings({ screenProbeUpdateSpeed: 4 }).maxFramesAccumulated, 5)
  assert.equal(screenProbeSettings({ screenProbeUpdateSpeed: 1000 }).maxFramesAccumulated, 4)
  assert.equal(screenProbeSettings({ screenProbeUpdateSpeed: 0.001 }).maxFramesAccumulated, 14)
  // A history longer than fifteen frames is the reference's too: the count is coded as a share of it in four bits.
  assert.equal(
    screenProbeSettings({ screenProbeMaxFramesAccumulated: 30, screenProbeUpdateSpeed: 0.5 })
      .maxFramesAccumulated,
    42,
  )
  // The gather's side: the tracing one over the whole number nearest the inverse of the scale (2.5 rounds to 3: 8 / 3 is 2).
  const gather = (screenProbeGatherScale: number, screenProbeQuality = 1) =>
    screenProbeSettings({ screenProbeGatherScale, screenProbeQuality }).gatherResolution
  assert.deepEqual(
    [gather(1), gather(0.5), gather(0.4), gather(0.1), gather(0.5, 4)],
    [8, 4, 2, 1, 8],
  )
  // The light the rays follow needs the importance sampling on.
  assert.equal(
    screenProbeSettings({ screenProbeImportanceSampling: false }).importanceLighting,
    false,
  )
})

test('a switch off, or an occlusion of no strength, leaves its pass out; a value a rule does not take is refused', () => {
  assert.equal(screenProbeSettings({ screenProbeSpatialFilter: false }).spatialFilterPasses, 0)
  assert.equal(screenProbeSettings({ screenProbeSpatialFilterPasses: 5 }).spatialFilterPasses, 5)
  // The reference's filter runs where its kernel is above zero: the number of passes is not capped.
  assert.equal(screenProbeSettings({ screenProbeSpatialFilterKernel: 0 }).spatialFilterPasses, 0)
  assert.equal(screenProbeSettings({ screenProbeSpatialFilterPasses: 12 }).spatialFilterPasses, 12)
  assert.equal(screenProbeSettings({ screenProbeShortRangeOcclusion: false }).occlusion, false)
  assert.equal(screenProbeSettings({ screenProbeOcclusionIntensity: 0 }).occlusion, false)
  // Where the reference takes any value, so does the setting: no invented range.
  assert.equal(
    screenProbeSettings({ screenProbeAdaptiveFraction: 2 }).values.screenProbeAdaptiveFraction,
    2,
  )
  assert.equal(
    screenProbeSettings({ screenProbeMeshTraceDistance: 500 }).values.screenProbeMeshTraceDistance,
    500,
  )
  assert.equal(
    screenProbeSettings({ screenProbeDisocclusionMaxFrames: 0 }).values
      .screenProbeDisocclusionMaxFrames,
    0,
  )
  assert.equal(
    screenProbeSettings({ screenProbeMaxIterations: 0 }).values.screenProbeMaxIterations,
    0,
  )
  for (const refused of [
    { screenProbes: 'extreme' },
    { screenProbeQuality: 0 },
    { screenProbeSpatialFilterPasses: -1 },
    { screenProbeMaxFramesAccumulated: 0 },
    { screenProbeMaxRayDirections: 0 },
    { screenProbeOcclusionIntensity: 2 },
    { screenProbeMaxFastUpdate: 2 },
    { screenProbeFastUpdateFraction: 0 },
    { screenProbeMeshTraceDistance: -1 },
    { screenProbeMaxTraceDistance: 0 },
    { screenProbeMaxTraceDistance: 10486 },
    { screenProbeGatherScale: 1.5 },
    { screenProbeGatherScale: 0.05 },
    { screenProbeSpatialFilterMaxHitAngle: 0 },
    { screenProbes: 'ultra ' },
  ])
    assert.throws(() => screenProbeSettings(refused as never), TypeError, JSON.stringify(refused))
})

/** The reflections' settings the options give, over the screen probes' the options give too. */
const reflections = (options: object) =>
  resolveReflections(resolveSettings(REFLECTION_RULES, options), screenProbeSettings(options))

test('the reflections trace with the reference’s budgets: 50 screen iterations, 256 steps a ring, a step the probes’ ray over the reference’s longest', () => {
  const values = resolveSettings(REFLECTION_RULES, {})
  assert.equal(values.reflectionScreenSteps, 50)
  assert.equal(values.reflectionRingSteps, 256)
  assert.equal(values.reflectionDetailSteps, 64)
  assert.equal(values.reflectionDistantScreenSteps, 16)
  assert.equal(values.reflectionDistantScreenDistance, 2000)
  assert.deepEqual(
    [values.reflectionMeshTraces, values.reflectionDistantScreenTraces],
    [true, true],
  )
  // The reference's longest ray is four rings of 256 steps; the probes' ray holds `probeRayWork` units
  // and `probeRayTriangles` tests for it, so one step is four units of work and one test, a ring 1024 and 256:
  // pinned here, so that a retune of the probes' budget moves no reflection unseen.
  assert.equal(BOUNCE_SETTINGS.cascadeLevels, 4)
  assert.equal(4 * 256 * REFLECTION_WORK_PER_STEP, BOUNCE_SETTINGS.probeRayWork)
  assert.equal(4 * 256 * REFLECTION_TESTS_PER_STEP, BOUNCE_SETTINGS.probeRayTriangles)
  const settings = reflections({})
  assert.deepEqual([REFLECTION_WORK_PER_STEP, REFLECTION_TESTS_PER_STEP], [4, 1])
  assert.deepEqual([settings.ringWork, settings.ringTests], [1024, 256])
  assert.deepEqual([settings.detailWork, settings.detailTests], [256, 64])
  assert.deepEqual(reflections({ reflectionRingSteps: 1 }).ringWork, 4)
  // The detail window is the reference's own switch ANDed with the project's, off by default: the screen probes'
  // detail trace, which a level may forbid; the scene trace is the screen probes' switch.
  assert.deepEqual([settings.meshTraces, settings.sceneTraces], [false, true])
  assert.equal(reflections({ screenProbeMeshTraces: true }).meshTraces, true)
  assert.equal(
    reflections({ screenProbeMeshTraces: true, reflectionMeshTraces: false }).meshTraces,
    false,
  )
  assert.equal(reflections({ screenProbeMeshTraces: true, screenProbes: 'high' }).meshTraces, false)
  assert.equal(reflections({ screenProbeSceneTraces: false }).sceneTraces, false)
  assert.deepEqual(
    [settings.meshDistance, settings.meshEndDistance, settings.surfaceBias],
    [1.8, 40, 0.05],
  )
  for (const refused of [
    { reflectionScreenSteps: 0 },
    { reflectionRingSteps: 0 },
    { reflectionRingSteps: 2.5 },
    { reflectionDetailSteps: 0 },
    { reflectionDistantScreenSteps: 0 },
    { reflectionDistantScreenDistance: 0 },
    { reflectionQuality: 'ultra ' },
    { reflectionSampleSceneColor: 3 },
    { reflectionSampleSceneColorNormalThreshold: 181 },
    { reflectionMaxRoughnessToTrace: 1.5 },
    { reflectionBilateralDisocclusionFrames: 0 },
    { reflectionMaxRayIntensity: 0 },
  ])
    assert.throws(
      () => resolveSettings(REFLECTION_RULES, refused),
      TypeError,
      JSON.stringify(refused),
    )
  // The iterations have no upper bound: the reference takes any count.
  assert.equal(reflections({ reflectionScreenSteps: 300 }).screenSteps, 300)
  assert.equal(reflections({ reflectionRingSteps: 5000 }).ringWork, 20000)
  assert.equal(reflections({ reflectionDistantScreenSteps: 1000 }).distantSteps, 1000)
})

test('the reflections have the reference’s levels: off, then the rows high, ultra — the default — and cinematic', () => {
  const rows = (options: object) => {
    const s = reflections(options)
    return [s.level, s.enabled, s.block, s.reconstructionSamples, s.reconstructionMinWeight]
  }
  assert.deepEqual(
    rows({}),
    ['ultra', true, 1, 5, 0],
    'a ray every pixel: the reference’s default row',
  )
  assert.deepEqual(rows({ reflectionQuality: 'high' }), ['high', true, 2, 3, 1])
  assert.deepEqual(rows({ reflectionQuality: 'cinematic' }), ['cinematic', true, 1, 5, 0])
  assert.deepEqual(
    rows({ reflectionQuality: true }),
    ['ultra', true, 1, 5, 0],
    'true is the default level',
  )
  // Off traces no ray: no lobe is rough enough, the probes’ field answers every surface.
  assert.deepEqual(rows({ reflectionQuality: false }).slice(0, 2), ['off', false])
  assert.equal(reflections({ reflectionQuality: 'off' }).maxRoughness, 0)
  assert.equal(reflections({}).maxRoughness, 0.4)
  // The far trace needs the screen trace; the lit image of a scene hit needs it unless asked for always.
  const flags = (options: object) => {
    const s = reflections(options)
    return [s.screenTraces, s.distantTraces, s.sampleSceneColor]
  }
  assert.deepEqual(flags({}), [true, true, true])
  assert.deepEqual(flags({ reflectionScreenTraces: false }), [false, false, false])
  assert.deepEqual(flags({ reflectionScreenTraces: false, reflectionSampleSceneColor: 2 }), [
    false,
    false,
    true,
  ])
  assert.deepEqual(flags({ reflectionSampleSceneColor: 0 }), [true, true, false])
  assert.equal(Math.round(reflections({}).sampleFacing * 1e4) / 1e4, 0.0872, 'cos 85°')
})
