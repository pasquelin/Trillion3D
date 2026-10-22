import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_PROBE_QUEUE, BOUNCE_SETTINGS, resolveProbesPerFrame } from './contracts.ts'
import {
  DEFAULT_SCREEN_PROBE_LEVEL,
  SCREEN_PROBE_LEVELS,
  SCREEN_PROBE_LEVEL_KNOBS,
  SCREEN_PROBE_PRESET_LEVELS,
} from './screenProbeLevels.ts'
import { screenProbeSettings } from './screenProbeOptions.fixture.ts'
import {
  REFLECTION_RULES,
  REFLECTION_TESTS_PER_STEP,
  REFLECTION_WORK_PER_STEP,
  reflectionRingTests,
  reflectionRingWork,
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
  assert.deepEqual(
    [settings.level, settings.enabled, settings.downsampleFactor, settings.adaptiveProbes],
    ['ultra', true, 16, 8],
  )
  assert.deepEqual([settings.tracingResolution, settings.irradianceFormat], [8, 'sh3'])
  assert.deepEqual(
    [settings.adaptiveFraction, settings.spatialFilterPasses, settings.maxRayIntensity],
    [0.5, 3, 10],
  )
  assert.deepEqual(
    [settings.screenTraces, settings.importanceSampling, settings.temporal, settings.occlusion],
    [true, true, true, true],
  )
  assert.deepEqual(
    [
      settings.sceneTraces,
      settings.meshTraces,
      settings.meshTraceDistance,
      settings.meshTraceEndDistance,
    ],
    [true, false, 1.8, 40],
  )
  assert.deepEqual(
    [settings.surfaceBias, settings.historyDistanceThreshold, settings.relativeSpeedThreshold],
    [0.05, 0.01, 0.005],
  )
  assert.deepEqual(
    [settings.fastUpdateInverseFraction, settings.maxFastUpdate, settings.fastUpdateClamp],
    [10, 0.9, false],
  )
  assert.deepEqual(
    [
      settings.importanceLighting,
      settings.radianceHistory,
      settings.minPdfToTrace,
      settings.filterPositionWeightScale,
      settings.filterHitAngleDegrees,
    ],
    [true, true, 0.1, 1000, 10],
  )
  assert.deepEqual(
    [
      settings.disocclusionMaxFrames,
      settings.disocclusionFraction,
      settings.traceHistoryThickness,
      settings.relativeDepthThickness,
      settings.maxIterations,
    ],
    [4, 0.4, 0.005, 0.02, 50],
  )
})

test('each level holds its own row of the table, the detail trace is a switch over a level that allows it, and true and false are the default level and off', () => {
  for (const level of SCREEN_PROBE_LEVELS.filter((name) => name !== 'off')) {
    const row = SCREEN_PROBE_LEVEL_KNOBS[level]
    const at = screenProbeSettings({ screenProbes: level })
    assert.deepEqual(
      [at.downsampleFactor, at.adaptiveProbes, at.tracingResolution, at.irradianceFormat],
      [row.downsampleFactor, row.adaptiveProbes, row.tracingResolution, row.irradianceFormat],
      level,
    )
    assert.equal(at.stochasticInterpolation, row.stochasticInterpolation, level)
  }
  assert.deepEqual(
    (['high', 'ultra', 'cinematic'] as const).map(
      (level) => screenProbeSettings({ screenProbes: level }).downsampleFactor,
    ),
    [32, 16, 8],
  )
  assert.equal(screenProbeSettings({ screenProbes: 'off' }).enabled, false)
  // The level is read as the anti-aliasing's is: true the default level, false off.
  assert.equal(screenProbeSettings({ screenProbes: true }).level, DEFAULT_SCREEN_PROBE_LEVEL)
  assert.deepEqual(
    [
      screenProbeSettings({ screenProbes: false }).level,
      screenProbeSettings({ screenProbes: false }).enabled,
    ],
    ['off', false],
  )
  // The presets below the top write the levels the reference's scalability levels run.
  assert.deepEqual(
    Object.values(SCREEN_PROBE_PRESET_LEVELS).map((preset) => preset.screenProbes),
    ['off', 'off', 'high'],
  )
  // The detail trace is a switch, off, over a level that allows it: the high level never does.
  const detail = (screenProbes: 'high' | 'ultra' | 'cinematic') =>
    screenProbeSettings({ screenProbes, screenProbeMeshTraces: true }).meshTraces
  assert.deepEqual([detail('high'), detail('ultra'), detail('cinematic')], [false, true, true])
  assert.equal(screenProbeSettings({ screenProbes: 'cinematic' }).meshTraces, false)
})

test('the quality scales the rays and the tile, the update speed the history, each within its range', () => {
  assert.equal(screenProbeSettings({ screenProbeQuality: 4 }).tracingResolution, 16)
  assert.equal(screenProbeSettings({ screenProbeQuality: 100 }).tracingResolution, 16)
  assert.equal(screenProbeSettings({ screenProbeQuality: 0.05 }).tracingResolution, 4)
  assert.equal(screenProbeSettings({ screenProbeQuality: 5.9 }).downsampleFactor, 16)
  assert.equal(screenProbeSettings({ screenProbeQuality: 6 }).downsampleFactor, 8)
  assert.equal(screenProbeSettings({ screenProbeUpdateSpeed: 4 }).maxFramesAccumulated, 5)
  assert.equal(screenProbeSettings({ screenProbeUpdateSpeed: 1000 }).maxFramesAccumulated, 4)
  assert.equal(screenProbeSettings({ screenProbeUpdateSpeed: 0.001 }).maxFramesAccumulated, 14)
  // The count is kept in four bits: the most frames at a slow update speed is fifteen, not past it.
  assert.equal(
    screenProbeSettings({ screenProbeMaxFramesAccumulated: 15, screenProbeUpdateSpeed: 0.5 })
      .maxFramesAccumulated,
    15,
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
  assert.equal(screenProbeSettings({ screenProbeShortRangeOcclusion: false }).occlusion, false)
  assert.equal(screenProbeSettings({ screenProbeOcclusionIntensity: 0 }).occlusion, false)
  for (const refused of [
    { screenProbes: 'extreme' },
    { screenProbeQuality: 0 },
    { screenProbeSpatialFilterPasses: 9 },
    { screenProbeMaxFramesAccumulated: 16 },
    { screenProbeOcclusionIntensity: 2 },
    { screenProbeMaxFastUpdate: 2 },
    { screenProbeFastUpdateFraction: 0 },
    { screenProbeMeshTraceDistance: -1 },
    { screenProbeMeshTraceDistance: 201 },
    { screenProbeMaxIterations: 0 },
    { screenProbeDisocclusionMaxFrames: 16 },
    { screenProbeSpatialFilterMaxHitAngle: 0 },
    { screenProbes: 'ultra ' },
  ])
    assert.throws(() => screenProbeSettings(refused as never), TypeError, JSON.stringify(refused))
})

test('the reflections trace with the reference’s budgets: 50 screen iterations, 256 steps a ring, a step the probes’ ray over the reference’s longest', () => {
  const values = resolveSettings(REFLECTION_RULES, {})
  assert.equal(values.reflectionScreenSteps, 50)
  assert.equal(values.reflectionRingSteps, 256)
  // The reference's longest ray is four rings of 256 steps; the probes' ray holds `probeRayWork` units
  // and `probeRayTriangles` tests for it, so one step is four units of work and one test, a ring 1024 and 256.
  assert.equal(
    BOUNCE_SETTINGS.cascadeLevels * 256 * REFLECTION_WORK_PER_STEP,
    BOUNCE_SETTINGS.probeRayWork,
  )
  assert.equal(
    BOUNCE_SETTINGS.cascadeLevels * 256 * REFLECTION_TESTS_PER_STEP,
    BOUNCE_SETTINGS.probeRayTriangles,
  )
  assert.deepEqual([REFLECTION_WORK_PER_STEP, REFLECTION_TESTS_PER_STEP], [4, 1])
  assert.deepEqual([reflectionRingWork(256), reflectionRingTests(256)], [1024, 256])
  // A ring always holds a unit of work and a test; the steps are whole numbers within their range.
  assert.deepEqual([reflectionRingWork(1), reflectionRingTests(1)], [4, 1])
  for (const refused of [
    { reflectionScreenSteps: 0 },
    { reflectionScreenSteps: 257 },
    { reflectionRingSteps: 0 },
    { reflectionRingSteps: 4097 },
    { reflectionRingSteps: 2.5 },
  ])
    assert.throws(
      () => resolveSettings(REFLECTION_RULES, refused),
      TypeError,
      JSON.stringify(refused),
    )
})
