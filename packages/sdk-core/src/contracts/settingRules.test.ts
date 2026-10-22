// A count is a whole number from its least up, refused in those words; a non-negative number is a
// finite one of at least zero: the two a family's rules write through one constructor each; two
// readings of a family differ where one of its settings does; the sun's shadow rules read as any.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CUT_RULES } from './cutOptions.ts'
import { STREAMING_RULES } from './streamingOptions.ts'
import { near } from '../../../math/src/float/near.fixture.ts'
import {
  SUN_TEMPERATURE_RULES,
  temperatureColour,
  temperatureFactor,
} from '../modules/sky/sunColour.ts'
import { defineModule, mergeModuleParts, resolveModuleOption } from '../modules/descriptor.ts'
import {
  choiceSetting,
  countSetting,
  nonNegativeSetting,
  resolveSetting,
  resolveSettings,
  rulesOf,
  settingsDiffer,
  vectorSetting,
  settingsWatch,
} from './settingRules.ts'
import {
  farShadowDistance,
  SHADOW_DISTANCE_DEFAULT,
  SHADOW_RULES,
  shadowDistanceOf,
  type ShadowValues,
} from './shadowOptions.ts'
import { QUALITY_LEVELS } from '../runtime/qualityLevels.ts'
import { TESSELLATION_RULES } from './tessellationOptions.ts'

test('a count takes whole numbers from its least up and refuses the rest in words', () => {
  const frames = countSetting('frames', 5, 0),
    cells = countSetting('cells', 4, 1)
  assert.equal(resolveSetting(frames, 0), 0)
  assert.equal(resolveSetting(cells, null), 4)
  assert.throws(() => resolveSetting(cells, 0), /a whole number of at least 1, got 0/)
  assert.throws(() => resolveSetting(frames, 1.5), /a whole number of at least 0, got 1.5/)
  assert.throws(() => resolveSetting(frames, -1), /at least 0/)
})

test('a non-negative setting takes any finite number of at least zero', () => {
  const scale = nonNegativeSetting('scale', 1)
  assert.equal(resolveSetting(scale, 0), 0)
  assert.equal(resolveSetting(scale, 2.5), 2.5)
  assert.throws(() => resolveSetting(scale, -0.1), /a finite number of at least 0/)
  assert.throws(() => resolveSetting(scale, Infinity), /a finite number of at least 0/)
})

test('two readings of a family differ where one of its settings does', () => {
  const rules = rulesOf([countSetting('frames', 5, 0), nonNegativeSetting('scale', 1)] as const)
  const used = resolveSettings(rules, { scale: 2 })
  assert.equal(settingsDiffer(rules, used, resolveSettings(rules, { scale: 2 })), false)
  assert.equal(settingsDiffer(rules, used, resolveSettings(rules, { scale: 3 })), true)
  assert.equal(settingsDiffer(rules, used, resolveSettings(rules, { scale: 2, frames: 6 })), true)
})

// A module's option is read by one resolver, and the sources' parts merge field by field.
test('a module option is true, false, silent or an object of its parts, and nothing else', () => {
  const sky = defineModule({
    name: 'sky',
    enabledByDefault: false,
    requires: [],
    parts: ['clouds'],
  })
  assert.deepEqual(resolveModuleOption(sky, true), { parts: {} })
  assert.equal(resolveModuleOption(sky, false), false)
  assert.equal(resolveModuleOption(sky, null), undefined)
  assert.throws(() => resolveModuleOption(sky, { fog: true }), /unknown part "fog"/)
  assert.throws(() => resolveModuleOption(sky, { clouds: 3 as never }), /neither a boolean/)
  const stronger = { parts: { clouds: { a: 1 } } },
    weaker = { parts: { clouds: { a: 2, b: 3 } } }
  assert.deepEqual(mergeModuleParts(sky, [stronger, weaker]), { clouds: { a: 1, b: 3 } })
  assert.deepEqual(mergeModuleParts(sky, [{ parts: { clouds: false } }, weaker]), { clouds: false })
})

test('a vector takes finite numbers of its default length, and two readings compare by parts', () => {
  const colour = vectorSetting('colour', [0.1, 0.2, 0.3])
  assert.deepEqual(resolveSetting(colour, null), [0.1, 0.2, 0.3])
  assert.deepEqual(resolveSetting(colour, [1, 0, 0]), [1, 0, 0])
  assert.throws(() => resolveSetting(colour, [1, 0]), /an array of 3 finite numbers, got 1,0/)
  assert.throws(() => resolveSetting(colour, [1, 0, Infinity]), /an array of 3 finite numbers/)
  const rules = rulesOf([colour] as const)
  const used = resolveSettings(rules, { colour: [1, 0, 0] })
  assert.equal(settingsDiffer(rules, used, resolveSettings(rules, { colour: [1, 0, 0] })), false)
  assert.equal(settingsDiffer(rules, used, resolveSettings(rules, { colour: [1, 0, 1] })), true)
})

test('the temperature colour is white off, and a black body clamped to 1000..15000 K on', () => {
  const near = (got: readonly number[], want: readonly number[]) =>
    got.forEach((x, i) => assert.ok(Math.abs(x - want[i]!) < 1e-4, `${got} vs ${want}`))
  const rest = resolveSettings(SUN_TEMPERATURE_RULES, {})
  assert.deepEqual([rest.useTemperature, rest.temperatureKelvin], [false, 6500])
  assert.deepEqual(temperatureColour([0.5, 0.6, 0.7], rest), [0.5, 0.6, 0.7])
  near(temperatureFactor(1000), [4.60024713, 0.0397531, 0])
  near(temperatureFactor(6500), [1.04415519, 0.98326854, 1.03569215])
  near(temperatureFactor(15000), [0.78461866, 0.99252683, 1.70842794])
  assert.deepEqual(temperatureFactor(10), temperatureFactor(1000))
  assert.deepEqual(temperatureFactor(1e6), temperatureFactor(15000))
  const on = resolveSettings(SUN_TEMPERATURE_RULES, { useTemperature: true })
  assert.deepEqual(temperatureColour([1, 1, 1], on), temperatureFactor(6500))
})

const presetShadows = (level: 'smooth' | 'balanced' | 'fine' | 'max') =>
  resolveSettings(SHADOW_RULES, QUALITY_LEVELS.shadows[level] as never)

test('the sun’s shadow settings read by their rules, and its far-shadow edge follows its quality levels', () => {
  assert.deepEqual(resolveSettings(SHADOW_RULES, {}), {
    shadowDistanceScale: 1,
    farShadowCulling: true,
    farShadowCullsAllMeshes: false,
    shadowNearLevels: 10,
    shadowOverlapScale: 1,
    shadowFarField: true,
    shadowMultipassViews: true,
  })
  assert.equal(resolveSetting(SHADOW_RULES.shadowDistanceScale, 2), 2)
  assert.throws(() => resolveSetting(SHADOW_RULES.shadowDistanceScale, 2.1), /from 0 to 2/)
  assert.throws(() => resolveSetting(SHADOW_RULES.shadowDistanceScale, -0.1), /from 0 to 2/)
  assert.throws(() => resolveSetting(SHADOW_RULES.farShadowCulling, 1 as never), /true or false/)
  const passes = SHADOW_RULES.shadowMultipassViews // a switch, on by default, and nothing else
  assert.throws(() => resolveSetting(passes, 0 as never), /true or false/)
  assert.throws(() => resolveSetting(SHADOW_RULES.shadowNearLevels, 11), /from 0 to 10/)
  assert.throws(() => resolveSetting(SHADOW_RULES.shadowNearLevels, 1.5), /whole/)
  assert.throws(() => resolveSetting(SHADOW_RULES.shadowOverlapScale, 2.1), /from 0 to 2/)
  // The edge: the last near level's far end, with its overlap into the next while a far-field
  // shadow follows. Of N levels each 3 times the one before, the last starts at (3^(N−1) − 1) /
  // (3^N − 1) of the span from the near plane, its overlap a tenth of its length times the scale.
  const edges = (settings: ShadowValues, distance = SHADOW_DISTANCE_DEFAULT) =>
    farShadowDistance(distance, 0.05, settings)
  near(edges(presetShadows('smooth')), 240, 'smooth: one level, no far field: the distance', 1e-9)
  near(edges(presetShadows('balanced')), 280, 'balanced: the same, at 0.7', 1e-9)
  near(edges(presetShadows('fine')), 358.357, 'fine: four levels, an overlap of 0.8', 1e-3)
  near(edges(presetShadows('max')), 427.0, 'max, the defaults: 427.0', 0.01)
  const max = presetShadows('max')
  near(farShadowDistance(400, 0, max), 427, 'no near plane: 427 exactly', 1e-9)
  near(edges(max, 500), 500 + 0.0675 * (500 - 0.05), 'under 512: a far field follows', 1e-9)
  assert.equal(edges(max, 512), 512, 'at 512, none follows')
  assert.equal(edges(max, 600), 600, 'past 512: the distance itself')
  assert.equal(farShadowDistance(400, 0.05, { ...max, shadowDistanceScale: 2 }), 800, 'scaled')
  // Two levels: the last starts at 2/8 of the span from the near plane.
  near(
    edges({ ...max, shadowNearLevels: 2 }),
    400 + 0.1 * (400 - (0.05 + 0.25 * 399.95)),
    'two',
    1e-9,
  )
  assert.equal(edges({ ...max, shadowNearLevels: 4 }), edges(max), 'no more than the light’s four')
  assert.equal(edges({ ...max, shadowFarField: false }), 400, 'no far field: the distance')
  assert.equal(edges({ ...max, shadowOverlapScale: 0 }), 400, 'no overlap: the distance')
  near(edges({ ...max, shadowOverlapScale: 2 }), 400 + 0.135 * 399.95, 'twice the overlap', 1e-9)
  for (const none of [
    { ...max, farShadowCulling: false },
    { ...max, shadowDistanceScale: 0 },
    { ...max, shadowNearLevels: 0 },
  ])
    assert.equal(edges(none), 0, 'no limit')
  assert.equal(farShadowDistance(0, 0.05, max), 0, 'a light of no distance: no limit')
  // The distance as a page writes it: metres, true the default, false none, nothing else.
  assert.deepEqual(
    [undefined, null, true, false, 0, 90.5].map((option) => shadowDistanceOf(option)),
    [400, 400, 400, 0, 0, 90.5],
  )
  for (const bad of [-1, NaN, Infinity, '400', {}])
    assert.throws(() => shadowDistanceOf(bad as number), /shadowDistance: must be a finite number/)
})

test('the cut culls an object by the distances it names, at their own size, unless asked otherwise', () => {
  assert.equal(CUT_RULES.cutDrawDistanceCulling.default, true)
  assert.equal(resolveSetting(CUT_RULES.cutDrawDistanceCulling, null), true)
  assert.equal(resolveSetting(CUT_RULES.cutDrawDistanceCulling, false), false)
  assert.throws(() => resolveSetting(CUT_RULES.cutDrawDistanceCulling, 'no'), /true or false/)
  assert.equal(resolveSetting(CUT_RULES.cutViewDistanceScale, undefined), 1)
  assert.equal(resolveSetting(CUT_RULES.cutViewDistanceScale, 0), 0)
  assert.equal(resolveSetting(CUT_RULES.cutViewDistanceScale, 2.5), 2.5)
  assert.throws(
    () => resolveSetting(CUT_RULES.cutViewDistanceScale, -1),
    /a finite number of at least 0/,
  )
})

test('the cut applies no view’s clip plane unless asked, culls by it and filters by the lists unless asked otherwise', () => {
  assert.equal(CUT_RULES.cutClipPlane.default, false)
  assert.equal(CUT_RULES.cutClipPlaneCulling.default, true)
  assert.equal(CUT_RULES.cutViewFiltering.default, true)
  for (const field of ['cutClipPlane', 'cutClipPlaneCulling', 'cutViewFiltering'] as const) {
    assert.equal(resolveSetting(CUT_RULES[field], true), true)
    assert.equal(resolveSetting(CUT_RULES[field], false), false)
    assert.throws(() => resolveSetting(CUT_RULES[field], 'no'), /true or false/)
  }
})

test('the cut’s GPU time budget is off at 0, its lowest scale 30 % from 1 to 100; the streaming simulates no bandwidth', () => {
  const { cutEdgeScaleBudgetMs: budget, cutEdgeScaleMinPercent: lowest } = CUT_RULES
  assert.equal(resolveSetting(budget, undefined), 0, 'no budget')
  assert.equal(resolveSetting(budget, -4), -4, 'a budget of 0 or less is none, as it is read')
  assert.equal(resolveSetting(budget, 8.3), 8.3)
  assert.throws(() => resolveSetting(budget, Number.NaN), /a number from/)
  assert.equal(resolveSetting(lowest, null), 30)
  assert.equal(resolveSetting(lowest, 1), 1)
  assert.equal(resolveSetting(lowest, 100), 100)
  for (const bad of [0.5, 101, Infinity])
    assert.throws(() => resolveSetting(lowest, bad), /a number from 1 to 100/)
  const { streamingBandwidthLimit: bandwidth } = STREAMING_RULES
  assert.equal(resolveSetting(bandwidth, undefined), -1, 'no limit')
  assert.equal(resolveSetting(bandwidth, 0), 0)
  assert.equal(resolveSetting(bandwidth, 2.5), 2.5)
  assert.throws(() => resolveSetting(bandwidth, '1' as never), /a number from/)
})

test('a level rule — a choice whose first name is off — also takes true for its default and false for off', () => {
  const quality = choiceSetting('quality', 'high', ['off', 'low', 'high'] as const)
  assert.deepEqual(
    [undefined, null, true, false, 'low', 'off'].map((option) => resolveSetting(quality, option)),
    ['high', 'high', 'high', 'off', 'low', 'off'],
  )
  assert.throws(
    () => resolveSetting(quality, 'ultra' as never),
    /one of 'off', 'low', 'high', true or false/,
  )
  // Any other choice, and a number, take no switch: a boolean is refused as it was.
  const mode = choiceSetting('mode', 'auto', ['auto', 'manual'] as const)
  assert.throws(() => resolveSetting(mode, true as never), /one of 'auto', 'manual', got true/)
  assert.throws(
    () => resolveSetting(CUT_RULES.cutViewDistanceScale, true as never),
    /a finite number/,
  )
})

test('a watch of a family reads it into one object and says whether any setting moved since the last reading that moved', () => {
  const rules = rulesOf([countSetting('frames', 5, 0), nonNegativeSetting('scale', 1)] as const)
  const watch = settingsWatch(rules)
  const first = watch.read({})
  assert.deepEqual([watch.moved, first.frames, first.scale], [true, 5, 1])
  assert.deepEqual(
    [watch.read({ scale: 1 }) === first, watch.moved],
    [true, false],
    'the same object, nothing moved',
  )
  watch.read({ scale: 2 })
  assert.deepEqual([watch.moved, first.scale], [true, 2])
  watch.read({ scale: 2, frames: 5 })
  assert.equal(watch.moved, false)
  watch.read({ frames: 6 })
  assert.deepEqual([watch.moved, first.frames, first.scale], [true, 6, 1])
})

test('the tessellation rules default to the reference and refuse what they do not take', () => {
  assert.deepEqual(resolveSettings(TESSELLATION_RULES, {}), {
    tessellation: true,
    tessellationDicingRate: 2,
    tessellationMaxPatchesPerGroup: 5,
    tessellationMaxCandidatePatches: 2 * 1048576,
    tessellationMaxVisiblePatches: 2 * 1048576,
  })
  const rate = TESSELLATION_RULES.tessellationDicingRate
  assert.equal(resolveSetting(rate, 0.5), 0.5)
  assert.throws(() => resolveSetting(rate, 0), /a finite number of pixels above zero, got 0/)
  assert.throws(
    () => resolveSetting(TESSELLATION_RULES.tessellationMaxPatchesPerGroup, 0),
    /a whole number of at least 1, got 0/,
  )
  assert.throws(
    () => resolveSetting(TESSELLATION_RULES.tessellationMaxVisiblePatches, 134217728),
    /a whole number from 1 to 134217727/,
  )
  assert.throws(
    () => resolveSetting(TESSELLATION_RULES.tessellation, 'yes' as never),
    /true or false/,
  )
})
