// The sun's view settings each say what they do: a setting no code reads the effect of says so, in
// the words a model reads (`trillion3d_set_shadows`), rather than promise a shadow it never draws.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SUN_SHADOW_RULES } from '../contracts/sunShadowOptions.ts'
import { SHADOW_SUN_MEANINGS } from './shadowSunMeanings.ts'
import { SHADOW_VIEW_MEANINGS } from './shadowViewMeanings.ts'

test('every sun setting has a meaning, and the far distance override says it moves a level nothing draws', () => {
  for (const { field } of SUN_SHADOW_RULES)
    assert.ok(SHADOW_SUN_MEANINGS[field as keyof typeof SHADOW_SUN_MEANINGS]?.length > 20, field)
  const override = SHADOW_SUN_MEANINGS.shadowFarDistanceOverride
  assert.match(override, /no visible effect/)
  assert.match(override, /draws none/)
  // Far levels are counted, not drawn: it does not promise a far shadow either.
  assert.match(SHADOW_SUN_MEANINGS.shadowMaxFarCascades, /counted, not drawn/)
})

test('no shadow setting’s meaning sends its reader to a reference it cannot look at: it says what the setting does', () => {
  const texts = { ...SHADOW_VIEW_MEANINGS, ...SHADOW_SUN_MEANINGS }
  for (const [field, text] of Object.entries(texts)) assert.doesNotMatch(text, /reference/i, field)
})
