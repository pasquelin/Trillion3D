import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_PROBE_QUEUE, BOUNCE_SETTINGS, resolveProbesPerFrame } from './contracts.ts'
import { DEFAULT_SCREEN_PROBE_LEVEL, SCREEN_PROBE_LEVEL_KNOBS } from './screenProbeLevels.ts'
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
  // The default is the row of the default level: a host that names none gets the level's own budget.
  assert.equal(
    BOUNCE_SETTINGS.probesPerFrame,
    SCREEN_PROBE_LEVEL_KNOBS[DEFAULT_SCREEN_PROBE_LEVEL as 'ultra'].radianceProbeBudget,
  )
  assert.ok(BOUNCE_SETTINGS.probesPerFrame <= BOUNCE_PROBE_QUEUE)
  assert.equal(resolveProbesPerFrame(1), 1)
  assert.equal(resolveProbesPerFrame(BOUNCE_PROBE_QUEUE), BOUNCE_PROBE_QUEUE)
  for (const asked of [0, -3, 1.5, NaN, Infinity, BOUNCE_PROBE_QUEUE + 1])
    assert.throws(() => resolveProbesPerFrame(asked), RangeError, `${asked}`)
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
