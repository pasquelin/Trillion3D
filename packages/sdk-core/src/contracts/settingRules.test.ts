// A count is a whole number from its least up, refused in those words; a non-negative number is a
// finite one of at least zero: the two a family's rules write through one constructor each; two
// readings of a family differ where one of its settings does; the sun's shadow rules read as any.
import test from 'node:test'
import { EXPOSURE_CURVE_SAMPLES, resolveExposureCurve } from './exposureCurve.ts'
import { exposureCurveAt } from './exposureCurveEval.ts'
import { bakeExposureCurve, exposureCurveFactor } from './exposureCurveTable.ts'
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
import {
  AMBIENT_OCCLUSION_PRESET_LEVELS,
  AMBIENT_OCCLUSION_RULES,
  ambientOcclusionMode,
  resolveAmbientOcclusion,
} from './ambientOcclusionOptions.ts'
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

test('the exposure compensation curve bakes 64 factors over EV100 -10 to 20', () => {
  assert.equal(resolveExposureCurve(undefined), null)
  assert.equal(resolveExposureCurve(false), null)
  assert.equal(resolveExposureCurve([]), null)
  assert.ok(bakeExposureCurve(null).every((factor) => factor === 1))
  // Keys are sorted; the compensation is linear between them and held past the ends.
  const curve = resolveExposureCurve([
    [10, -2],
    [0, 1],
  ])
  assert.deepEqual(
    curve?.keys.map((key) => [key.ev, key.compensation]),
    [
      [0, 1],
      [10, -2],
    ],
  )
  assert.equal(exposureCurveAt(curve, -5), 1)
  assert.equal(exposureCurveAt(curve, 5), -0.5)
  assert.equal(exposureCurveAt(curve, 15), -2)
  const table = bakeExposureCurve(curve)
  assert.equal(table.length, EXPOSURE_CURVE_SAMPLES)
  assert.equal(table[0], 2) // EV100 -10, held at the first key: 2^1
  assert.equal(table[63], 0.25) // EV100 20, held at the last key: 2^-2
  assert.equal(table[21], 2) // sample 21 is EV100 -10 + 21 · 30 / 63 = 0: the first key
  assert.equal(table[42], 0.25) // sample 42 is EV100 10: the last key
  // Sample 31 is EV100 4.7619...: 2^(1 - 3 · 0.47619) held as a half float.
  assert.equal(table[31], Math.f16round(2 ** (1 - 3 * (4.761904761904762 / 10))))
  // The shader's read: samples mixed, the ends held.
  assert.equal(exposureCurveFactor(table, 0), 2)
  assert.equal(exposureCurveFactor(table, -50), 2)
  assert.equal(exposureCurveFactor(table, 50), 0.25)
  assert.throws(
    () =>
      resolveExposureCurve([
        [0, 1],
        [0, 2],
      ]),
    /share the EV100/,
  )
  assert.throws(() => resolveExposureCurve([[0, Number.NaN]]), /finite number/)
  assert.throws(
    () => resolveExposureCurve([{ ev: 0, compensation: 0, interpolation: 'spline' }] as never),
    /interpolation/,
  )
})

test('an exposure curve key runs to the next as a line, a step or a cubic by its tangents', () => {
  const near = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`)
  // A step holds the key's value up to the next key, which it then takes.
  const step = resolveExposureCurve([
    { ev: 0, compensation: 1, interpolation: 'constant' },
    [10, 3],
  ])
  assert.equal(exposureCurveAt(step, 5), 1)
  assert.equal(exposureCurveAt(step, 9.999), 1)
  assert.equal(exposureCurveAt(step, 10), 3)
  // Auto tangents: (0,0), (10,10), (20,0) all cubic. The middle one is (10 - 0 + 0 - 10) / 20 = 0,
  // the ends flat; the first segment is the Bezier 0, 0, 10, 10: at 2.5, t = 0.25,
  // 3 · 0.75 · 0.0625 · 10 + 0.015625 · 10 = 1.5625.
  const flat = resolveExposureCurve(
    [0, 10, 20].map((ev, i) => ({
      ev,
      compensation: [0, 10, 0][i],
      interpolation: 'cubic' as const,
    })),
  )
  assert.deepEqual(
    flat?.keys.map((key) => [key.arriveTangent, key.leaveTangent]),
    [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  )
  near(exposureCurveAt(flat, 2.5), 1.5625)
  // A middle key at (10,10) between (0,0) and (30,10): tangent (10 - 0 + 10 - 10) / 30 = 1/3; the
  // first segment's second handle is 10 - (1/3) · 10 / 3, and at 5 the value is
  // 0.375 · 8.8888... + 0.125 · 10 = 4.58333...
  const skewed = resolveExposureCurve([
    { ev: 0, compensation: 0, interpolation: 'cubic' },
    { ev: 10, compensation: 10, interpolation: 'cubic' },
    { ev: 30, compensation: 10, interpolation: 'cubic' },
  ])
  near(skewed?.keys[1].arriveTangent ?? 0, 1 / 3)
  near(skewed?.keys[1].leaveTangent ?? 0, 1 / 3)
  near(exposureCurveAt(skewed, 5), 0.375 * (10 - 10 / 9) + 1.25)
  // User tangents: leave 0 at the first, arrive 2 at the second: handles 0 and 10 - 2 · 10 / 3,
  // at 5: 0.375 · 3.3333... + 0.125 · 10 = 2.5.
  const user = resolveExposureCurve([
    { ev: 0, compensation: 0, interpolation: 'cubic', tangentMode: 'user', leaveTangent: 0 },
    { ev: 10, compensation: 10, tangentMode: 'user', arriveTangent: 2 },
  ])
  near(exposureCurveAt(user, 5), 2.5)
  // A user tangent written on one side is the other's too.
  assert.equal(
    resolveExposureCurve([{ ev: 0, compensation: 0, tangentMode: 'user', leaveTangent: 2 }])
      ?.keys[0].arriveTangent,
    2,
  )
  // Broken tangents: leave 3 and arrive 0 give handles 10 and 10; at 5:
  // 0.375 · 10 + 0.375 · 10 + 0.125 · 10 = 8.75.
  const broken = resolveExposureCurve([
    { ev: 0, compensation: 0, interpolation: 'cubic', tangentMode: 'break', leaveTangent: 3 },
    { ev: 10, compensation: 10, tangentMode: 'break', arriveTangent: 0 },
  ])
  near(exposureCurveAt(broken, 5), 8.75)
  // Weighted handles, tangents 0, weights 5: the handles' times are 5 and 5, so the Bezier of the
  // times 0, 0.5, 0.5, 1 is solved for 2.5 (a bisection here, not Cardano's formula), and the
  // values 0, 0, 10, 10 are read at that parameter.
  const weighted = resolveExposureCurve([
    {
      ev: 0,
      compensation: 0,
      interpolation: 'cubic',
      tangentMode: 'user',
      weightMode: 'both',
      leaveWeight: 5,
    },
    { ev: 10, compensation: 10, tangentMode: 'user', weightMode: 'both', arriveWeight: 5 },
  ])
  const time = (t: number) => 1.5 * t * (1 - t) + t ** 3
  let low = 0
  let high = 1
  for (let i = 0; i < 80; i++)
    if (time((low + high) / 2) < 0.25) low = (low + high) / 2
    else high = (low + high) / 2
  const t = (low + high) / 2
  near(exposureCurveAt(weighted, 2.5), 3 * (1 - t) * t * t * 10 + t ** 3 * 10)
})

test('an exposure curve goes on outside its keys by its extrapolation', () => {
  const keys = [
    [0, 0],
    [10, 10],
  ] as const
  const outside = (before: never, after: never) => resolveExposureCurve({ keys, before, after })
  const at = (extrapolation: string, ev: number) =>
    exposureCurveAt(outside(extrapolation as never, extrapolation as never), ev)
  assert.equal(exposureCurveAt(resolveExposureCurve(keys), 15), 10) // held by default
  assert.equal(exposureCurveAt(resolveExposureCurve(keys), -5), 0)
  assert.equal(at('linear', 15), 15)
  assert.equal(at('linear', -5), -5)
  // Cycle: 15 is 5 one cycle on, 25 is 5 two on, -2 is 8 one cycle back; none reads as a cycle.
  assert.equal(at('cycle', 15), 5)
  assert.equal(at('cycle', 25), 5)
  assert.equal(at('cycle', 12), 2)
  assert.equal(at('cycle', -2), 8)
  assert.equal(at('none', 15), 5)
  // Cycle with offset: the cycle plus the keys' rise (10) a cycle.
  assert.equal(at('cycleWithOffset', 15), 15)
  assert.equal(at('cycleWithOffset', 25), 25)
  assert.equal(at('cycleWithOffset', -2), -2)
  // Oscillate: odd cycles run back; 12 is 2 in one cycle: 0 + (10 - 2) = 8; 22 is two cycles: 2;
  // -2 is 8 one cycle back, run back: 2.
  assert.equal(at('oscillate', 12), 8)
  assert.equal(at('oscillate', 22), 2)
  assert.equal(at('oscillate', -2), 2)
  assert.throws(
    () => resolveExposureCurve({ keys, after: 'spin' as never }),
    /after must be one of/,
  )
})

/** The sun's shadow settings a quality preset resolves to: the shadows group's level over the
 *  defaults. */
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

test('the ambient occlusion settings read by their rules with the reference’s defaults, its lengths in metres', () => {
  const values = resolveSettings(AMBIENT_OCCLUSION_RULES, {})
  // The reference's post-process defaults (intensity 0.5, radius 200, fade 8000 and 5000 centimetres, power 2, bias 3,
  // quality 50, mip blend 0.6, scale 1.7, threshold 0.01) and the comparison run's level-3 cvars.
  assert.deepEqual(values, {
    ambientOcclusion: true,
    ambientOcclusionIntensity: 0.5,
    ambientOcclusionStaticFraction: 1,
    ambientOcclusionRadius: 2,
    ambientOcclusionRadiusInWorldSpace: false,
    ambientOcclusionFadeDistance: 80,
    ambientOcclusionFadeRadius: 50,
    ambientOcclusionPower: 2,
    ambientOcclusionBias: 3,
    ambientOcclusionQuality: 50,
    ambientOcclusionMipBlend: 0.6,
    ambientOcclusionMipScale: 1.7,
    ambientOcclusionMipThreshold: 0.01,
    ambientOcclusionLevels: -1,
    ambientOcclusionMaxQuality: 100,
    ambientOcclusionMipLevelFactor: 0.4,
    ambientOcclusionRadiusScale: 1,
    ambientOcclusionWithScreenProbes: false,
  })
  for (const [field, value] of [
    ['ambientOcclusionIntensity', 1.5],
    ['ambientOcclusionPower', 0],
    ['ambientOcclusionMipBlend', 0.05],
    ['ambientOcclusionLevels', 4],
    ['ambientOcclusionRadiusScale', 20],
  ] as const)
    assert.throws(() => resolveSetting(AMBIENT_OCCLUSION_RULES[field], value), /must be/, field)
})

test('the ambient occlusion’s quality picks its resolutions and its samples as the reference’s does', () => {
  const settings = (
    options: Parameters<typeof resolveSettings<typeof AMBIENT_OCCLUSION_RULES>>[1],
  ) => resolveAmbientOcclusion(resolveSettings(AMBIENT_OCCLUSION_RULES, options))
  // The default quality 50: two resolutions, the medium samples; the radius scaled and in centimetres.
  const normal = settings({})
  assert.deepEqual(
    [normal.quality, normal.levels, normal.shaderQuality, normal.radiusCm, normal.enabled],
    [50, 2, 2, 200, true],
  )
  // Each step of the quality: over 35 and 70 a resolution more, over 5, 25, 55 and 75 a shape more.
  const at = (ambientOcclusionQuality: number) => {
    const { levels, shaderQuality } = settings({ ambientOcclusionQuality })
    return [levels, shaderQuality]
  }
  assert.deepEqual([0, 5, 6, 25, 26, 35, 36, 55, 56, 70, 71, 75, 76, 100].map(at), [
    [1, 0],
    [1, 0],
    [1, 1],
    [1, 1],
    [1, 2],
    [1, 2],
    [2, 2],
    [2, 2],
    [2, 3],
    [2, 3],
    [3, 3],
    [3, 3],
    [3, 4],
    [3, 4],
  ])
  // The ceiling holds the quality down; a negative one names it; the levels name the resolutions.
  assert.equal(
    settings({ ambientOcclusionQuality: 90, ambientOcclusionMaxQuality: 60 }).quality,
    60,
  )
  assert.equal(settings({ ambientOcclusionMaxQuality: -80 }).quality, 80)
  assert.equal(settings({ ambientOcclusionLevels: 3 }).levels, 3)
  assert.equal(settings({ ambientOcclusionLevels: 1, ambientOcclusionQuality: 100 }).levels, 1)
  // The radius scales, in centimetres.
  assert.equal(
    settings({ ambientOcclusionRadius: 3, ambientOcclusionRadiusScale: 1.5 }).radiusCm,
    450,
  )
  // Nothing draws with the switch off, an intensity of 0, no resolution, or a radius under a tenth of a centimetre.
  for (const off of [
    { ambientOcclusion: false },
    { ambientOcclusionIntensity: 0 },
    { ambientOcclusionLevels: 0 },
    { ambientOcclusionRadius: 0.001, ambientOcclusionRadiusScale: 0.5 },
  ])
    assert.equal(settings(off).enabled, false, JSON.stringify(off))
  // The smooth level writes no resolution at all: the reference's first post-process level.
  assert.equal(settings(AMBIENT_OCCLUSION_PRESET_LEVELS.smooth).enabled, false)
  assert.equal(settings(AMBIENT_OCCLUSION_PRESET_LEVELS.balanced).enabled, true)
})

test('the ambient occlusion draws where no screen probes light the pixels, or occludes their light when asked and their own is off', () => {
  const on = resolveAmbientOcclusion(resolveSettings(AMBIENT_OCCLUSION_RULES, {}))
  const asked = resolveAmbientOcclusion(
    resolveSettings(AMBIENT_OCCLUSION_RULES, { ambientOcclusionWithScreenProbes: true }),
  )
  const off = resolveAmbientOcclusion(
    resolveSettings(AMBIENT_OCCLUSION_RULES, { ambientOcclusionIntensity: 0 }),
  )
  assert.equal(ambientOcclusionMode(on, { probes: false, shortRange: true }), 'scene')
  assert.equal(ambientOcclusionMode(on, { probes: false, shortRange: false }), 'scene')
  // With the screen probes, their short-range occlusion replaces it: nothing, by default.
  assert.equal(ambientOcclusionMode(on, { probes: true, shortRange: true }), 'none')
  assert.equal(ambientOcclusionMode(on, { probes: true, shortRange: false }), 'none')
  // Asked, and the probes' own occlusion off, it occludes their light; their own on, never.
  assert.equal(ambientOcclusionMode(asked, { probes: true, shortRange: false }), 'probes')
  assert.equal(ambientOcclusionMode(asked, { probes: true, shortRange: true }), 'none')
  assert.equal(ambientOcclusionMode(off, { probes: false, shortRange: false }), 'none')
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
