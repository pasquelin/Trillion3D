// The light functions' settings read by their rules: the fog's sun texture takes its reference supersample scale, above 0.
import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveSetting } from './settingRules.ts'
import { LIGHT_FUNCTION_RULES } from './lightFunctionOptions.ts'

test('the fog sun light function texture is two cells a side by default and takes any scale above 0', () => {
  const rule = LIGHT_FUNCTION_RULES.lightFunctionFogSupersample
  assert.equal(resolveSetting(rule), 2)
  assert.equal(resolveSetting(rule, 0.5), 0.5)
  assert.throws(() => resolveSetting(rule, 0), /lightFunctionFogSupersample/)
  assert.throws(() => resolveSetting(rule, -1), /lightFunctionFogSupersample/)
})
