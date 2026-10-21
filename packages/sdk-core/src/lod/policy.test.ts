import test from 'node:test'
import assert from 'node:assert/strict'
import { LOD_QUALITY, lodQuality } from './policy.ts'
test('LOD presets are explicit pixel-error configurations', () => {
  assert.equal(lodQuality('source').pixelError, 0)
  assert.equal(LOD_QUALITY.high.pixelError, 1)
  assert.equal(LOD_QUALITY.balanced.pixelError, 4)
  assert.throws(() => lodQuality('nope'))
})
