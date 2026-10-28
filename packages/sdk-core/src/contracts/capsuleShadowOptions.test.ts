// The view's capsule shadow settings: on by default, half resolution, the reach of the shadows in metres, each read by its rule.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CAPSULE_SHADOW_MEANINGS } from '../llm/capsuleShadowMeanings.ts'
import { resolveSetting, resolveSettings } from './settingRules.ts'
import {
  CAPSULE_SHADOW_RULES,
  CAPSULE_SHADOW_VIEW_RULES,
  OBJECT_CAPSULE_SHADOW_RULES,
  capsuleDirectOn,
  capsuleIndirectOn,
} from './capsuleShadowOptions.ts'

test('the capsule shadows are on at half resolution, with the reference reach', () => {
  const defaults = resolveSettings(CAPSULE_SHADOW_VIEW_RULES, {})
  assert.equal(defaults.capsuleShadows, true)
  assert.equal(defaults.capsuleDirectShadows, true)
  assert.equal(defaults.capsuleIndirectShadows, true)
  assert.equal(defaults.capsuleShadowsFullResolution, false)
  // 400 and 200 centimetres, 60 degrees and 22.5 degrees in radians, as the reference's cvars.
  assert.equal(defaults.capsuleMaxDirectOcclusionDistance, 4)
  assert.equal(defaults.capsuleMaxIndirectOcclusionDistance, 2)
  assert.equal(defaults.capsuleShadowFadeAngleFromVertical, Math.PI / 3)
  assert.equal(defaults.capsuleIndirectConeAngle, Math.PI / 8)
  assert.equal(defaults.capsuleSkyAngleScale, 0.6)
  assert.equal(defaults.capsuleMinSkyAngle, 15)
  assert.equal(defaults.capsuleIndirectSelfShadowingIntensity, 0.8)
})

test('each takes what its rule says, and nothing else', () => {
  for (const field of [
    'capsuleShadows',
    'capsuleDirectShadows',
    'capsuleIndirectShadows',
    'capsuleShadowsFullResolution',
  ] as const)
    assert.throws(
      () => resolveSetting(CAPSULE_SHADOW_VIEW_RULES[field], 1 as never),
      /true or false/,
    )
  // A reach divides: above 0. So does an angle that is a cone's: above 0.
  for (const field of [
    'capsuleMaxDirectOcclusionDistance',
    'capsuleMaxIndirectOcclusionDistance',
    'capsuleIndirectConeAngle',
    'capsuleMinSkyAngle',
  ] as const) {
    assert.equal(resolveSetting(CAPSULE_SHADOW_VIEW_RULES[field], 3), 3, field)
    assert.throws(() => resolveSetting(CAPSULE_SHADOW_VIEW_RULES[field], 0), /above 0/, field)
    assert.throws(() => resolveSetting(CAPSULE_SHADOW_VIEW_RULES[field], -1), /above 0/, field)
  }
  assert.equal(resolveSetting(CAPSULE_SHADOW_VIEW_RULES.capsuleSkyAngleScale, 0), 0)
  assert.throws(() => resolveSetting(CAPSULE_SHADOW_VIEW_RULES.capsuleSkyAngleScale, -0.1))
  assert.equal(resolveSetting(CAPSULE_SHADOW_VIEW_RULES.capsuleShadowFadeAngleFromVertical, 0), 0)
  assert.throws(() =>
    resolveSetting(CAPSULE_SHADOW_VIEW_RULES.capsuleShadowFadeAngleFromVertical, Math.PI + 0.1),
  )
})

test('the master switch gates both kinds', () => {
  const on = resolveSettings(CAPSULE_SHADOW_VIEW_RULES, {})
  assert.ok(capsuleDirectOn(on) && capsuleIndirectOn(on))
  const off = resolveSettings(CAPSULE_SHADOW_VIEW_RULES, { capsuleShadows: false })
  assert.ok(!capsuleDirectOn(off) && !capsuleIndirectOn(off))
  const direct = resolveSettings(CAPSULE_SHADOW_VIEW_RULES, { capsuleIndirectShadows: false })
  assert.ok(capsuleDirectOn(direct) && !capsuleIndirectOn(direct))
})

test('each says what it means, and none speaks of the reference', () => {
  for (const { field } of CAPSULE_SHADOW_RULES) {
    const text = CAPSULE_SHADOW_MEANINGS[field]
    assert.ok(text.length > 20, field)
    assert.doesNotMatch(text, /reference/i, field)
  }
})

test('an object casts none until it asks, and leaves a tenth of the indirect light under its shadow', () => {
  const object = resolveSettings(OBJECT_CAPSULE_SHADOW_RULES, {})
  assert.equal(object.castCapsuleDirectShadow, false)
  assert.equal(object.castCapsuleIndirectShadow, false)
  assert.equal(object.capsuleIndirectShadowMinVisibility, 0.1)
  assert.equal(resolveSetting(OBJECT_CAPSULE_SHADOW_RULES.capsuleIndirectShadowMinVisibility, 1), 1)
  assert.throws(() =>
    resolveSetting(OBJECT_CAPSULE_SHADOW_RULES.capsuleIndirectShadowMinVisibility, 1.5),
  )
  assert.throws(
    () => resolveSetting(OBJECT_CAPSULE_SHADOW_RULES.castCapsuleDirectShadow, 1 as never),
    /true or false/,
  )
})
