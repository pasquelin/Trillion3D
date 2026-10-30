import test from 'node:test'
import assert from 'node:assert/strict'
import { POWER_DELTA_ENTRY, powerDeltaWgsl } from './powerDeltaWgsl.ts'

test('the power delta writes the ratio of last image’s power to this one’s (over 0.01) and keeps this power', () => {
  const code = powerDeltaWgsl()
  assert.ok(code.includes(`fn ${POWER_DELTA_ENTRY}(`))
  assert.ok(code.includes('before/max(power,0.01)'))
  assert.ok(code.includes('powerNow[rank]=power;'))
  assert.ok(
    code.includes('fn lightFunctionOf('),
    'the engine’s light function, evaluated once at the light',
  )
  assert.ok(
    !code.includes('view.') && !code.includes('var<uniform> params'),
    'it reads no surface nor view: it runs before the image’s surfaces',
  )
})

test('the power delta covers the simple lights after the scene’s and reads the power before at the rank the light had', () => {
  const code = powerDeltaWgsl()
  assert.ok(code.includes('rank>=directLights.count+directLights.simple'))
  assert.ok(code.includes('previousRanks[rank]'))
  assert.ok(code.includes('powerBefore[u32(after)]'))
  assert.ok(
    code.includes('ratios[arrayLength(&ratios)/2u+rank]=word;'),
    'the rank before is handed on to the draws',
  )
})
