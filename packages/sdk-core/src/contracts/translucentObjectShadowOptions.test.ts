// The translucent object shadows: off for the project, on for a light, off for an object, half the opacity for a material.
import test from 'node:test'
import assert from 'node:assert/strict'
import { TRANSLUCENT_OBJECT_SHADOW_MEANINGS } from '../llm/translucentObjectShadowMeanings.ts'
import { resolveSettings } from './settingRules.ts'
import {
  LIGHT_TRANSLUCENT_SHADOW_DEFAULT,
  MATERIAL_TRANSLUCENT_SHADOW_RULES,
  OBJECT_TRANSLUCENT_SHADOW_RULES,
  TRANSLUCENT_OBJECT_SHADOW_RULES,
} from './translucentObjectShadowOptions.ts'
import { SHADOW_RULES } from './shadowOptions.ts'

test('the project switch is off and part of the view shadow settings', () => {
  assert.equal(SHADOW_RULES.translucentObjectShadows.default, false)
  for (const { field } of TRANSLUCENT_OBJECT_SHADOW_RULES) {
    assert.ok(TRANSLUCENT_OBJECT_SHADOW_MEANINGS[field].length > 20, field)
    assert.doesNotMatch(TRANSLUCENT_OBJECT_SHADOW_MEANINGS[field], /reference/i, field)
  }
})

test('a light lets translucent surfaces cast, an object does not until it asks, a material is half as dense', () => {
  assert.equal(LIGHT_TRANSLUCENT_SHADOW_DEFAULT, true)
  assert.equal(
    resolveSettings(OBJECT_TRANSLUCENT_SHADOW_RULES, {}).castVolumetricTranslucentShadow,
    false,
  )
  assert.equal(
    resolveSettings(MATERIAL_TRANSLUCENT_SHADOW_RULES, {}).translucentShadowDensityScale,
    0.5,
  )
  const material = resolveSettings(MATERIAL_TRANSLUCENT_SHADOW_RULES, {})
  assert.equal(material.translucentShadowStartOffset, 100)
  assert.equal(material.translucentSelfShadowDensityScale, 2)
  assert.equal(material.translucentSelfShadowSecondDensityScale, 10)
  assert.equal(material.translucentSelfShadowSecondOpacity, 0)
  assert.equal(material.translucentBackscatteringExponent, 30)
  assert.throws(() =>
    resolveSettings(MATERIAL_TRANSLUCENT_SHADOW_RULES, { translucentShadowDensityScale: -1 }),
  )
})
