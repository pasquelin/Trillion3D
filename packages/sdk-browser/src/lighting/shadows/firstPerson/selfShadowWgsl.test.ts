import assert from 'node:assert/strict'
import test from 'node:test'
import { SELF_SHADOW_ENTRIES, SELF_SHADOW_MAX_SUNS, selfShadowProgram } from './selfShadowWgsl.ts'

test('each kernel is a program with its entry and the engine’s march', () => {
  for (const entry of Object.values(SELF_SHADOW_ENTRIES)) {
    const code = selfShadowProgram(entry, 'none')
    assert.ok(code.includes(`fn ${entry}(`), entry)
  }
  assert.ok(selfShadowProgram(SELF_SHADOW_ENTRIES.trace, 'none').includes('fn screenMarch('))
})

test('the march gives up on occupancy only under the polyfill', () => {
  const trace = SELF_SHADOW_ENTRIES.trace
  assert.ok(!selfShadowProgram(trace, 'none').includes('screenMarchLane'))
  const polyfill = selfShadowProgram(trace, 'polyfill')
  assert.ok(polyfill.includes('screenMarchLane=lane;'))
  assert.ok(polyfill.includes('params.counts.w'))
})

test('the uniform holds a direction a sun', () => {
  assert.ok(
    selfShadowProgram(SELF_SHADOW_ENTRIES.upsample, 'none').includes(
      `suns:array<vec4f,${SELF_SHADOW_MAX_SUNS}>`,
    ),
  )
})
