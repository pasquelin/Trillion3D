import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEG2RAD,
  FINITE_SENTINEL,
  FLOAT32_MAX,
  FLOAT32_STEP,
  GOLDEN_ANGLE,
  GOLDEN_FRACTION,
  HALF_PI,
  MIB,
  PI,
  QUARTER_PI,
  RAD2DEG,
  SQRT3,
  TAU,
} from './constants.ts'

test('each constant is the bits of the expression its doc names', () => {
  assert.equal(PI, Math.PI)
  assert.equal(HALF_PI, Math.PI / 2)
  assert.equal(QUARTER_PI, Math.PI / 4)
  assert.equal(TAU, Math.PI * 2)
  assert.equal(DEG2RAD, Math.PI / 180)
  assert.equal(RAD2DEG, 180 / Math.PI)
  assert.equal(GOLDEN_FRACTION, (Math.sqrt(5) - 1) / 2)
  assert.equal(SQRT3, Math.sqrt(3))
  assert.equal(GOLDEN_ANGLE, Math.PI * (3 - Math.sqrt(5)))
  assert.equal(FLOAT32_STEP, 2 ** -23)
  assert.equal(MIB, 1024 * 1024)
})

test('QUARTER_PI, SQRT3 and GOLDEN_ANGLE against their independent definitions', () => {
  // tan(π/4) = 1 and 3 is the square of SQRT3, each to an ulp; the golden angle is 2π over φ², φ²
  // being φ + 1, and the turn's complement 2π − γ is 2π/φ.
  assert.ok(Math.abs(Math.tan(QUARTER_PI) - 1) <= Number.EPSILON)
  assert.ok(Math.abs(SQRT3 * SQRT3 - 3) <= 3 * Number.EPSILON)
  const phi = (1 + Math.sqrt(5)) / 2
  assert.ok(Math.abs(GOLDEN_ANGLE - (2 * Math.PI) / (phi * phi)) <= 4 * Number.EPSILON)
  assert.ok(Math.abs(2 * Math.PI - GOLDEN_ANGLE - (2 * Math.PI) / phi) <= 8 * Number.EPSILON)
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
