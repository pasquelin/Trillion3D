// A count is a whole number from its least up, refused in those words; a non-negative number is a
// finite one of at least zero: the two a family's rules write through one constructor each; two
// readings of a family differ where one of its settings does; the sun's shadow rules read as any.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CUT_RULES } from './cutOptions.ts'
import { STREAMING_RULES } from './streamingOptions.ts'
import { near } from '../../../math/src/float/near.fixture.ts'
import {
  choiceSetting,
  countSetting,
  nonNegativeSetting,
  resolveSetting,
  resolveSettings,
  rulesOf,
  settingsDiffer,
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
