// The view's contact shadow settings: on by default, no override of the lights' own, each read by its
// rule and listed with the shadow settings; the light's own are `lightContactShadowOptions.ts`'.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CONTACT_SHADOW_MEANINGS } from '../llm/contactShadowMeanings.ts'
import { resolveSetting, resolveSettings } from './settingRules.ts'
import { CONTACT_SHADOW_RULES } from './contactShadowOptions.ts'
import { SHADOW_PRESET_LEVELS, SHADOW_RULES } from './shadowOptions.ts'

const FIELDS = [
  'contactShadows',
  'contactShadowOverrideLength',
  'contactShadowOverrideLengthInWorldSpace',
  'contactShadowOverrideCastingIntensity',
  'contactShadowOverrideNonCastingIntensity',
] as const

const OVERRIDES = FIELDS.filter(
  (field) => field.startsWith('contactShadowOverride') && !field.endsWith('InWorldSpace'),
)

test('the contact shadows are on, and nothing overrides the lights’ own', () => {
  assert.deepEqual(
    CONTACT_SHADOW_RULES.map((rule) => rule.field),
    FIELDS,
  )
  const defaults = resolveSettings(SHADOW_RULES, {})
  assert.equal(defaults.contactShadows, true)
  assert.equal(defaults.contactShadowOverrideLengthInWorldSpace, false)
  for (const field of OVERRIDES) assert.equal(defaults[field], -1, field)
})

test('each takes what its rule says, and nothing else', () => {
  for (const field of ['contactShadows', 'contactShadowOverrideLengthInWorldSpace'] as const) {
    assert.equal(resolveSetting(SHADOW_RULES[field], undefined), SHADOW_RULES[field].default)
    assert.throws(() => resolveSetting(SHADOW_RULES[field], 1 as never), /true or false/, field)
  }
  // A length is any finite number, a negative one none; so is an intensity (the folded one is held to 1,
  // `writeContactShadow`).
  assert.equal(resolveSetting(SHADOW_RULES.contactShadowOverrideLength, 0.02), 0.02)
  assert.equal(resolveSetting(SHADOW_RULES.contactShadowOverrideLength, -3), -3)
  assert.throws(() => resolveSetting(SHADOW_RULES.contactShadowOverrideLength, Infinity), /number/)
  for (const field of [
    'contactShadowOverrideCastingIntensity',
    'contactShadowOverrideNonCastingIntensity',
  ] as const) {
    assert.equal(resolveSetting(SHADOW_RULES[field], 0.5), 0.5)
    assert.equal(resolveSetting(SHADOW_RULES[field], -1), -1)
    assert.equal(resolveSetting(SHADOW_RULES[field], 3), 3, 'any number, as the reference’s cvar')
    assert.equal(resolveSetting(SHADOW_RULES[field], -2), -2, 'below 0, none')
    assert.throws(() => resolveSetting(SHADOW_RULES[field], Infinity), /number/, field)
  }
})

test('the quality levels write none of them, and each says what it means', () => {
  for (const level of Object.values(SHADOW_PRESET_LEVELS))
    for (const field of FIELDS) assert.ok(!(field in level), field)
  for (const field of FIELDS) {
    const text = CONTACT_SHADOW_MEANINGS[field]
    assert.ok(text.length > 20, field)
    assert.doesNotMatch(text, /reference/i, field)
  }
})
