// A count is a whole number from its least up, refused in those words; a non-negative number is a
// finite one of at least zero: the two a family's rules write through one constructor each; two
// readings of a family differ where one of its settings does (`shadowOptions.test.ts` reads the
// shadow rules).
import test from 'node:test'
import assert from 'node:assert/strict'
import { CUT_RULES } from './cutOptions.ts'
import { STREAMING_RULES } from './streamingOptions.ts'
import {
  choiceSetting,
  countSetting,
  nonNegativeSetting,
  nonZeroSetting,
  resolveSetting,
  resolveSettings,
  rulesOf,
  settingsDiffer,
  settingsWatch,
} from './settingRules.ts'
import {
  AMBIENT_OCCLUSION_PRESET_LEVELS,
  AMBIENT_OCCLUSION_RULES,
  ambientOcclusionMode,
  resolveAmbientOcclusion,
} from './ambientOcclusionOptions.ts'
import { TESSELLATION_RULES } from './tessellationOptions.ts'
import { VOLUMETRIC_FOG_RULES } from './volumetricFogOptions.ts'

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

test('the cut’s GPU time budget is off, its lowest scale 30 % from 1 to 100, the streaming’s bandwidth unlimited', () => {
  const { cutEdgeScaleBudgetMs: budget, cutEdgeScaleMinPercent: lowest } = CUT_RULES
  const { streamingBandwidthLimit: bandwidth } = STREAMING_RULES
  assert.deepEqual(
    [budget, lowest, bandwidth].map((rule) => resolveSetting(rule)),
    [0, 30, -1],
  )
  assert.deepEqual(
    [-4, 8.3].map((value) => resolveSetting(budget, value)),
    [-4, 8.3],
  )
  for (const bad of [0.5, 101, Infinity])
    assert.throws(() => resolveSetting(lowest, bad), /a number from 1 to 100/)
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
    tessellationShadowsDirectional: true,
    tessellationShadowsLocal: true,
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

test('a non-zero setting takes any finite number but zero', () => {
  const spread = nonZeroSetting('spread', 32, 'any number but 0')
  assert.equal(resolveSetting(spread, -4), -4)
  assert.equal(resolveSetting(spread, 1e6), 1e6)
  assert.throws(() => resolveSetting(spread, 0), /any number but 0, got 0/)
  assert.throws(() => resolveSetting(spread, NaN), /any number but 0/)
})

test('the fog volume’s numbers take what the engines that fixed them let them take', () => {
  const rules = VOLUMETRIC_FOG_RULES
  // A history share past 1 or below 0 extrapolates the history; a lamp softening, a sample scatter, a
  // surface lift and its range are any number — a negative lift puts none.
  for (const name of [
    'volumetricFogHistoryShare',
    'volumetricFogLampSoftening',
    'volumetricFogSampleScatter',
    'volumetricFogSurfaceLift',
    'volumetricFogLiftRange',
    'volumetricFogEdgeFade',
    'volumetricFogReadJitter',
  ] as const)
    for (const value of [-3, 0, 1.5, 40])
      assert.equal(resolveSetting(rules[name], value), value, `${name} ${value}`)
  // The slice spread of 0 is a grid of NaN: refused, any other number taken.
  assert.equal(resolveSetting(rules.volumetricFogSliceSpread, -8), -8)
  assert.throws(
    () => resolveSetting(rules.volumetricFogSliceSpread, 0),
    /volumetricFogSliceSpread: must be a finite number but 0, which the slices divide by, got 0/,
  )
})
