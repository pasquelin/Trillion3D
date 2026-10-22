// The shadow settings read by their rules: the sun's distance and the edge of its far-shadow test
// follow the quality levels, and the shadow maps' own settings (`shadowMapOptions.ts`: the clipmap's
// levels, the coarse pages, the resolution biases, the radius threshold, the rays and steps of a
// trace, the page pool) take the numbers of the reference's scalability rows.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { QUALITY_LEVELS } from '../runtime/qualityLevels.ts'
import { resolveSetting, resolveSettings } from './settingRules.ts'
import {
  farShadowDistance,
  SHADOW_DISTANCE_DEFAULT,
  SHADOW_RULES,
  shadowDistanceOf,
  type ShadowValues,
} from './shadowOptions.ts'

/** The shadow maps' own settings at their defaults, the reference's fourth row. */
const SHADOW_MAP_DEFAULTS = {
  ...{ shadowClipmapFirstLevel: 6, shadowClipmapLastLevel: 22 },
  ...{ shadowClipmapFirstCoarseLevel: 15, shadowClipmapLastCoarseLevel: 18 },
  ...{ shadowClipmapZRangeScale: 1000, shadowMarkCoarsePagesDirectional: 2 },
  ...{ shadowMarkCoarsePagesLocal: 1, shadowResolutionLodBiasDirectional: -1.5 },
  ...{ shadowResolutionLodBiasDirectionalMoving: -1.5, shadowResolutionLodBiasLocal: 0 },
  ...{ shadowResolutionLodBiasLocalMoving: 1, shadowLightActiveFrameCount: 10 },
  ...{ shadowRadiusThreshold: 0.01, shadowRadiusThresholdUncached: true },
  ...{ shadowRayCountDirectional: 8, shadowSamplesPerRayDirectional: 4 },
  ...{ shadowRayCountLocal: 8, shadowSamplesPerRayLocal: 4, shadowMaxPhysicalPages: 4096 },
}

/** The sun's shadow settings a quality preset resolves to: the shadows group's level over the
 *  defaults. */
const presetShadows = (level: 'smooth' | 'balanced' | 'fine' | 'max') =>
  resolveSettings(SHADOW_RULES, QUALITY_LEVELS.shadows[level] as never)

test('the sun’s shadow settings read by their rules, and its far-shadow edge follows its quality levels', () => {
  assert.deepEqual(resolveSettings(SHADOW_RULES, {}), {
    ...{ shadowDistanceScale: 1, farShadowCulling: true, farShadowCullsAllMeshes: false },
    ...{ shadowNearLevels: 10, shadowOverlapScale: 1, shadowFarField: true },
    ...{ shadowMultipassViews: true, ...SHADOW_MAP_DEFAULTS },
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

/** The reference's scalability rows of the shadow maps' settings: smooth, balanced, fine. */
const ROWS = {
  shadowMarkCoarsePagesLocal: [2, 2, 2],
  shadowResolutionLodBiasDirectional: [0, 0, 0],
  shadowResolutionLodBiasDirectionalMoving: [0, 0, 0],
  shadowResolutionLodBiasLocal: [1, 1, 0],
  shadowResolutionLodBiasLocalMoving: [2, 2, 1],
  shadowRadiusThreshold: [0.06, 0.05, 0.04],
  shadowRayCountDirectional: [0, 4, 8],
  shadowSamplesPerRayDirectional: [2, 2, 4],
  shadowRayCountLocal: [0, 4, 4],
  shadowSamplesPerRayLocal: [2, 2, 4],
  shadowMaxPhysicalPages: [512, 512, 2048],
} as const

test('the shadow maps’ settings take the rows of the first three quality levels, the fourth the defaults', () => {
  const levels = ['smooth', 'balanced', 'fine'] as const
  for (const field of Object.keys(SHADOW_MAP_DEFAULTS) as (keyof typeof SHADOW_MAP_DEFAULTS)[]) {
    const row = (ROWS as Record<string, readonly number[]>)[field]
    for (const [k, level] of levels.entries())
      assert.equal(
        presetShadows(level)[field],
        row ? row[k] : SHADOW_MAP_DEFAULTS[field],
        `${level} ${field}: ${row ? 'its row' : 'no level writes it'}`,
      )
  }
  assert.deepEqual(presetShadows('max'), resolveSettings(SHADOW_RULES, {}), 'max writes nothing')
})

test('the shadow maps’ settings refuse what they cannot take, in words', () => {
  const refuses = (field: keyof typeof SHADOW_MAP_DEFAULTS, value: unknown, words: RegExp) =>
    assert.throws(() => resolveSetting(SHADOW_RULES[field], value as never), words, field)
  refuses('shadowMarkCoarsePagesLocal', 3, /from 0 to 2/)
  refuses('shadowMarkCoarsePagesDirectional', 0.5, /whole/)
  refuses('shadowRayCountLocal', 16, /from 0 to 15/)
  refuses('shadowRayCountDirectional', 1.5, /whole/)
  refuses('shadowSamplesPerRayLocal', 65, /from 0 to 64/)
  refuses('shadowClipmapLastLevel', 31, /from 0 to 30/)
  refuses('shadowClipmapZRangeScale', 0, /above 0/)
  refuses('shadowLightActiveFrameCount', 0, /at least 1/)
  refuses('shadowMaxPhysicalPages', 0, /at least 1/)
  refuses('shadowRadiusThreshold', -1, /at least 0/)
  refuses('shadowRadiusThresholdUncached', 1, /true or false/)
  refuses('shadowResolutionLodBiasLocal', 17, /from -16 to 16/)
  // The ends are taken; 16 rays, one more than a mask lane's nibble holds, is refused above.
  assert.equal(resolveSetting(SHADOW_RULES.shadowRayCountLocal, 15), 15)
  assert.equal(resolveSetting(SHADOW_RULES.shadowResolutionLodBiasDirectional, -16), -16)
  assert.equal(resolveSetting(SHADOW_RULES.shadowRadiusThreshold, 0), 0)
})
