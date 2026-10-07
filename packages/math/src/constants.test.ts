import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEG2RAD,
  FINITE_SENTINEL,
  FLOAT32_MAX,
  FLOAT32_STEP,
  GOLDEN_FRACTION,
  HALF_PI,
  MIB,
  RAD2DEG,
  TAU,
} from './constants.ts'

test('each constant is the bits of the expression its doc names', () => {
  assert.equal(HALF_PI, Math.PI / 2)
  assert.equal(TAU, Math.PI * 2)
  assert.equal(DEG2RAD, Math.PI / 180)
  assert.equal(RAD2DEG, 180 / Math.PI)
  assert.equal(GOLDEN_FRACTION, (Math.sqrt(5) - 1) / 2)
  assert.equal(FLOAT32_STEP, 2 ** -23)
  assert.equal(MIB, 1024 * 1024)
})

test('FLOAT32_MAX is the largest finite float32 and not 3.4e38', () => {
  assert.equal(FLOAT32_MAX, (2 - 2 ** -23) * 2 ** 127)
  assert.equal(Math.fround(FLOAT32_MAX), FLOAT32_MAX)
  assert.equal(new Float32Array([FLOAT32_MAX])[0], FLOAT32_MAX)
  assert.equal(Math.fround(FLOAT32_MAX * (1 + 2 ** -25)), FLOAT32_MAX)
  assert.equal(Math.fround(FLOAT32_MAX * 1.0001), Infinity)
  assert.notEqual(Math.fround(3.4e38), FLOAT32_MAX)
})

test('FINITE_SENTINEL is 3.4e38, a float32 under FLOAT32_MAX', () => {
  assert.equal(FINITE_SENTINEL, 3.4e38)
  assert.ok(Math.fround(FINITE_SENTINEL) < FLOAT32_MAX)
  assert.equal(Math.fround(Math.fround(FINITE_SENTINEL) * 2), Infinity)
})
