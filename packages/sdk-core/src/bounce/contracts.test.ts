import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_PROBE_QUEUE, BOUNCE_SETTINGS, resolveProbesPerFrame } from './contracts.ts'
import { DEFAULT_SCREEN_PROBE_LEVEL, SCREEN_PROBE_LEVEL_KNOBS } from './screenProbeLevels.ts'
import { screenProbeSettings } from './screenProbeOptions.fixture.ts'
import { REFLECTION_RULES, resolveReflections } from '../contracts/reflectionOptions.ts'
import { resolveSettings, type SettingRule } from '../contracts/settingRules.ts'

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

test('the reflections trace with the reference’s budgets: 50 screen iterations, a far trace of 16 steps and 2 000 m, the scene marched through the field', () => {
  const values = resolveSettings(REFLECTION_RULES, {})
  assert.equal(values.reflectionScreenSteps, 50)
  assert.equal(values.reflectionDistantScreenSteps, 16)
  assert.equal(values.reflectionDistantScreenDistance, 2000)
  assert.equal(values.reflectionDistantScreenTraces, true)
  // The scene trace is the screen probes' switch, and marches the field wherever the level traces.
  const settings = reflections({})
  assert.deepEqual([settings.sceneTraces, settings.marchesField], [true, true])
  assert.deepEqual(
    [
      reflections({ screenProbeSceneTraces: false }).sceneTraces,
      reflections({ screenProbeSceneTraces: false }).marchesField,
    ],
    [false, false],
  )
  assert.equal(reflections({ reflectionQuality: 'off' }).marchesField, false)
  assert.equal(settings.surfaceBias, 0.05)
  // A host that checks no types may write any value to any setting: the rules, read by their kind alone.
  const anyRules: Readonly<Record<string, SettingRule>> = REFLECTION_RULES
  for (const refused of [
    { reflectionScreenSteps: 0 },
    { reflectionDistantScreenSteps: 0 },
    { reflectionDistantScreenDistance: 0 },
    { reflectionQuality: 'ultra ' },
    { reflectionSampleSceneColor: 3 },
    { reflectionSampleSceneColorNormalThreshold: 181 },
    { reflectionMaxRoughnessToTrace: 1.5 },
    { reflectionBilateralDisocclusionFrames: 0 },
    { reflectionMaxRayIntensity: 0 },
  ])
    assert.throws(() => resolveSettings(anyRules, refused), TypeError, JSON.stringify(refused))
  // The iterations have no upper bound: the reference takes any count.
  assert.equal(reflections({ reflectionScreenSteps: 300 }).screenSteps, 300)
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
  // The transparents' front layer is the reference's project setting, off by default: never at the high level, at the
  // cinematic level whatever the project says, at the default level only where the project asks for it.
  const front = (options: object) => reflections(options).frontLayer
  assert.equal(front({}), false)
  assert.equal(front({ reflectionFrontLayer: true }), true)
  assert.equal(front({ reflectionQuality: 'high', reflectionFrontLayer: true }), false)
  assert.equal(front({ reflectionQuality: 'cinematic' }), true)
  assert.equal(front({ reflectionQuality: 'cinematic', reflectionFrontLayer: false }), true)
  assert.equal(front({ reflectionQuality: 'off', reflectionFrontLayer: true }), false)
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
