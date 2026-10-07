import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEG2RAD,
  FLOAT32_MAX,
  FLOAT32_STEP,
  GOLDEN_FRACTION,
  GOLDEN_RATIO,
  HALF_PI,
  MIB,
  RAD2DEG,
  TAU,
} from './constants.ts'

test('constants hold their values', () => {
  assert.equal(HALF_PI * 2, Math.PI)
  assert.equal(TAU, 2 * Math.PI)
  assert.equal(DEG2RAD, Math.PI / 180)
  assert.equal(RAD2DEG, 180 / Math.PI)
  assert.ok(Math.abs(180 * DEG2RAD - Math.PI) < 1e-15)
  assert.ok(Math.abs(GOLDEN_RATIO - 1.618033988749895) < 1e-15)
  assert.ok(Math.abs(GOLDEN_FRACTION - (GOLDEN_RATIO - 1)) < 1e-15)
  assert.equal(GOLDEN_FRACTION, (Math.sqrt(5) - 1) / 2)
  assert.equal(FLOAT32_STEP, Math.fround(1 + 2 ** -23) - 1)
  assert.equal(MIB, 1048576)
})

test('FLOAT32_MAX is the largest finite float32 and not 3.4e38', () => {
  assert.equal(FLOAT32_MAX, (2 - 2 ** -23) * 2 ** 127)
  assert.equal(Math.fround(FLOAT32_MAX), FLOAT32_MAX)
  assert.equal(new Float32Array([FLOAT32_MAX])[0], FLOAT32_MAX)
  assert.equal(Math.fround(FLOAT32_MAX * (1 + 2 ** -25)), FLOAT32_MAX)
  assert.equal(Math.fround(FLOAT32_MAX * 1.0001), Infinity)
  assert.notEqual(Math.fround(3.4e38), FLOAT32_MAX)
})
