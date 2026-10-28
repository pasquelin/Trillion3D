import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BOUNCE_SETTINGS,
  probePoolOf,
  probeQueueFor as queueFor,
  probeQueueShapeFor,
  probeQueueShapeOf,
} from './contracts.ts'
import { DEFAULT_SCREEN_PROBE_LEVEL, SCREEN_PROBE_LEVEL_KNOBS } from './screenProbeLevels.ts'
import { screenProbeSettings } from './screenProbeOptions.fixture.ts'
import { REFLECTION_RULES, resolveReflections } from '../contracts/reflectionOptions.ts'
import { resolveSettings, type SettingRule } from '../contracts/settingRules.ts'

/** The probes a frame queues for `budget`, at the temporary atlas's factor the settings default to. */
const probeQueueFor = (budget: number) =>
  queueFor(budget, screenProbeSettings().cache.temporaryAtlasDownsample)

test('the temporary atlas’s factor defaults to 6, and the settings carry the one a host names', () => {
  assert.equal(screenProbeSettings().cache.temporaryAtlasDownsample, 6)
  assert.equal(
    screenProbeSettings({ screenProbeRadianceCacheTemporaryAtlasDownsampleFactor: 12 }).cache
      .temporaryAtlasDownsample,
    12,
  )
  assert.ok(queueFor(0, 12) < queueFor(0, 6), 'a larger factor leaves a smaller queue')
})

test('the probes one frame queues are the greater of the pool over the temporary atlas’s factor and four times the budget, in rows of a power of two', () => {
  const { probePool } = BOUNCE_SETTINGS
  // A small budget leaves the pool's share: a block of rows a power of two wide within a row of a sixth of the pool.
  assert.ok(Math.abs(probeQueueFor(0) - probePool / 6) < 128)
  assert.equal(
    probeQueueFor(100),
    probeQueueFor(0),
    '400 probes are under the pool’s share of 2 731',
  )
  // Past it, four times the budget: a budget of 1 000 names 4 000 probes, a block of 63 rows of 64 — the next power of two over its side.
  assert.equal(probeQueueFor(1000), 64 * Math.ceil(63 ** 2 / 64))
  assert.ok(probeQueueFor(1000) >= 3900 && probeQueueFor(1000) < 4000 + 64)
  // Never more than the pool holds.
  assert.equal(probeQueueFor(1e6), probePool)
})

test('the queue is laid in the rows of the temporary atlas its probes are traced into: a frame’s shape holds the probes it queues, a full update’s the whole pool in the pool’s own rows', () => {
  const { probePool } = BOUNCE_SETTINGS
  const shape = probeQueueShapeFor(8, 6)
  assert.equal(shape.probes, queueFor(8, 6))
  assert.equal(shape.row & (shape.row - 1), 0, 'a row a power of two wide')
  assert.equal(shape.probes % shape.row, 0, 'whole rows')
  assert.deepEqual(probeQueueShapeOf(8, 6, false), shape)
  assert.deepEqual(probeQueueShapeOf(8, 6, true), { row: 128, probes: probePool })
})

test('a pool of its own is a row a power of two wide of as many rows as hold the square of the side asked, within 1 to 255, the 16 bits of a slot plus one holding them', () => {
  assert.equal(probePoolOf(128), BOUNCE_SETTINGS.probePool)
  assert.equal(probePoolOf(100), 128 * 79)
  assert.equal(probePoolOf(0), 1)
  // 255 rows of 256: 65280 slots, the last one named 65280 in the owner word's 16 bits; a side of 256 would make 65536.
  assert.equal(probePoolOf(1e6), 256 * 255)
  assert.ok(probePoolOf(1e6) + 1 <= 0xffff)
  // The queue of a pool is never more than it holds, and the world's pool is the default.
  assert.equal(queueFor(1e6, 6, 4096), 4096)
  assert.equal(queueFor(0, 6, probePoolOf(100)) <= probePoolOf(100), true)
  assert.equal(queueFor(100, 6), queueFor(100, 6, BOUNCE_SETTINGS.probePool))
})

test('the update speed scales the budget the levels hold, within its range', () => {
  const budget = (options: object) => screenProbeSettings(options).cache.budget
  // The levels' own rows, at the default update speed: 100, 150 and 350 probes.
  assert.equal(
    budget({}),
    SCREEN_PROBE_LEVEL_KNOBS[DEFAULT_SCREEN_PROBE_LEVEL as 'ultra'].radianceProbeBudget,
  )
  assert.equal(budget({ screenProbes: 'cinematic' }), 350)
  // The fastest update speed on the greatest row is the greatest budget, and it is not held back: 1 400 maps name 5 600 probes, a block of
  // 43 rows of 128 (the side of 74 probes, floored, laid in rows of the next power of two).
  const greatest = budget({ screenProbes: 'cinematic', screenProbeUpdateSpeed: 4 })
  assert.equal(greatest, 1400)
  assert.equal(probeQueueFor(greatest), 128 * 43)
  assert.equal(budget({ screenProbes: 'cinematic', screenProbeUpdateSpeed: 100 }), greatest)
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
    { reflectionBilateralDisocclusionFrames: -1 },
    { reflectionBilateralDepthWeightScale: -1 },
    { reflectionMaxRayIntensity: 0 },
    { reflectionHistoryDepthTestRelativeThickness: 0 },
    { reflectionReconstructionRoughnessScale: 0 },
  ])
    assert.throws(() => resolveSettings(anyRules, refused), TypeError, JSON.stringify(refused))
  // The iterations have no upper bound: the reference takes any count.
  assert.equal(reflections({ reflectionScreenSteps: 300 }).screenSteps, 300)
  assert.equal(reflections({ reflectionDistantScreenSteps: 1000 }).distantSteps, 1000)
  // The march is never given up for want of lanes by default, as the reference's minimum occupancy of 0.
  assert.equal(reflections({}).screenMinimumOccupancy, 0)
  assert.equal(reflections({ reflectionScreenMinimumOccupancy: 8 }).screenMinimumOccupancy, 8)
  // The bilateral filter's boost: zero turns it off, and it never passes the images a history holds; its depth weight is 10 000.
  assert.equal(reflections({}).disocclusionFrames, 2)
  assert.equal(reflections({ reflectionBilateralDisocclusionFrames: 0 }).disocclusionFrames, 0)
  assert.equal(reflections({ reflectionMaxFramesAccumulated: 1 }).disocclusionFrames, 1)
  assert.equal(reflections({}).bilateralDepthScale, 10000)
  // The depth test of a screen hit against the last image holds 0.5 % of the depth, the reconstruction weighs on the surface's own roughness.
  assert.equal(reflections({}).historyDepthThickness, 0.005)
  assert.equal(reflections({}).reconstructionRoughnessScale, 1)
  assert.equal(
    reflections({ reflectionHistoryDepthTestRelativeThickness: 0.02 }).historyDepthThickness,
    0.02,
  )
  assert.equal(
    reflections({ reflectionReconstructionRoughnessScale: 2 }).reconstructionRoughnessScale,
    2,
  )
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
