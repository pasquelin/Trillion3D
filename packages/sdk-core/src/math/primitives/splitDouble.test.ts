import test from 'node:test'
import assert from 'node:assert/strict'
import { ceilFloat32, writeSplitDouble } from './splitDouble.ts'

test('float bounds round outward, including subnormals and negative values', () => {
  for (const value of [-1e9 - 0.01, -1.01, -1e-46, -0, 0, 1e-46, 0.001, 1.01, 1e9 + 0.01, Infinity])
    assert.ok(ceilFloat32(value) >= value, `${value}`)
  assert.ok(Number.isNaN(ceilFloat32(NaN)))
})

test('split coordinates retain centimetres and millimetres across high-word rounding boundaries', () => {
  const out = new Float32Array(2)
  for (const origin of [0, -1e6, 1e6, -1e9, 1e9])
    for (const delta of [0.001, 0.01, 31.999, 32.001]) {
      const value = origin + delta
      writeSplitDouble(out, 0, 1, value)
      assert.ok(Math.abs(out[0] + out[1] - value) < 2e-6)
    }
})
