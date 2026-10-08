import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEG2RAD,
  FAR_VALUE,
  FINITE_SENTINEL,
  FLOAT32_MAX,
  FLOAT32_MIN_NORMAL,
  FLOAT32_STEP,
  GOLDEN_ANGLE,
  GOLDEN_FRACTION,
  GOLDEN_U32,
  HALF_MAX,
  HALF_OVERFLOW,
  HALF_PI,
  MIB,
  OCT_BYTE_STEP,
  PI,
  PLASTIC_STEP_X,
  PLASTIC_STEP_Y,
  QUARTER_PI,
  RAD2DEG,
  SQRT3,
  TAU,
} from './constants.ts'
import { toHalf } from './float/half.ts'

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

test('the golden salt, the octahedral byte step and the least normal float32', () => {
  assert.equal(GOLDEN_U32, Math.floor(GOLDEN_FRACTION * 2 ** 32))
  assert.equal(GOLDEN_U32 % 2, 1)
  assert.equal(OCT_BYTE_STEP, Math.fround(2 / 255))
  assert.equal(new Float32Array([2 / 255])[0], OCT_BYTE_STEP)
  // 255 steps from -1 land within a float32 ulp of +1.
  assert.ok(Math.abs(Math.fround(Math.fround(255 * OCT_BYTE_STEP) - 1) - 1) <= 2 ** -23)
  assert.equal(FLOAT32_MIN_NORMAL, 2 ** -126)
  assert.equal(Math.fround(FLOAT32_MIN_NORMAL), FLOAT32_MIN_NORMAL)
  assert.equal(new Uint32Array(new Float32Array([FLOAT32_MIN_NORMAL]).buffer)[0], 0x00800000)
})

test('the half-float bounds: the greatest finite half, and where a half turns infinite', () => {
  // binary16: ten fraction bits, the greatest exponent 15.
  assert.equal(HALF_MAX, (2 - 2 ** -10) * 2 ** 15)
  assert.equal(HALF_OVERFLOW, 2 ** 16 - 2 ** 4)
  assert.equal(toHalf(HALF_MAX), 0x7bff)
  assert.equal(toHalf(HALF_OVERFLOW - 2 ** -6), 0x7bff)
  assert.equal(toHalf(HALF_OVERFLOW), 0x7c00)
})

test('FAR_VALUE is 1e30, its float32 square past the float32 range', () => {
  assert.equal(FAR_VALUE, 1e30)
  assert.ok(Math.fround(FAR_VALUE) < FLOAT32_MAX)
  assert.equal(Math.fround(Math.fround(FAR_VALUE) * Math.fround(FAR_VALUE)), Infinity)
})

test('the plastic steps are 1/p and 1/p², p the real root of x³ = x + 1', () => {
  let p = 1.3
  for (let i = 0; i < 50; i++) p -= (p * p * p - p - 1) / (3 * p * p - 1)
  assert.ok(Math.abs(p * p * p - p - 1) <= 4 * Number.EPSILON)
  assert.ok(Math.abs(PLASTIC_STEP_X - 1 / p) <= Number.EPSILON)
  assert.ok(Math.abs(PLASTIC_STEP_Y - 1 / (p * p)) <= Number.EPSILON)
})
