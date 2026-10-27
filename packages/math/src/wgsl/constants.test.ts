import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DIVISOR_FLOOR,
  FAR_VALUE,
  FINITE_SENTINEL,
  FLOAT32_MIN_NORMAL,
  HALF_MAX,
  INFINITE_THRESHOLD,
  PLASTIC_STEP,
  QUARTER_PI,
  RANGE_BOUND,
  SQRT2,
} from './constants.ts'
import { FINITE_SENTINEL as FINITE, FLOAT32_MAX } from '../constants.ts'

/** The number a WGSL scalar constant's literal names, as the device reads it. */
const literal = (text: string) => Number(/=(.+?)[uf]?;$/.exec(text)![1])

test('each sentinel names the f32 of its number, under the greatest f32', () => {
  for (const [decl, value] of [
    [FINITE_SENTINEL, FINITE],
    [INFINITE_THRESHOLD, 3.0e38],
    [FAR_VALUE, 1e30],
  ] as const) {
    assert.equal(Math.fround(literal(decl.text)), Math.fround(value), decl.name)
    assert.ok(literal(decl.text) < FLOAT32_MAX, decl.name)
  }
  assert.ok(literal(INFINITE_THRESHOLD.text) < literal(FINITE_SENTINEL.text))
})

test('each new constant names the f32 of its value, the shaders’ hand-typed literals the same', () => {
  const pairs = [
    [QUARTER_PI, Math.PI / 4, []],
    [SQRT2, Math.SQRT2, [String(Math.sqrt(2))]],
    [FLOAT32_MIN_NORMAL, 2 ** -126, ['1.17549435e-38']],
    [HALF_MAX, 65504, ['65504.0']],
    [DIVISOR_FLOOR, 1e-20, ['1e-20']],
    [RANGE_BOUND, 1e9, ['1e9']],
  ] as const
  for (const [decl, value, typed] of pairs) {
    assert.equal(Math.fround(literal(decl.text)), Math.fround(value), decl.name)
    for (const text of typed) assert.equal(Math.fround(Number(text)), Math.fround(value), text)
  }
  // `PI/4.0` of a shader: π/4 in f32 is the f32 of π over 4, exactly, a quarter moving the exponent.
  assert.equal(Math.fround(Math.fround(Math.PI) / 4), Math.fround(literal(QUARTER_PI.text)))
  const [x, y] = /vec2f\(([^,]+),([^)]+)\)/.exec(PLASTIC_STEP.text)!.slice(1).map(Number)
  assert.equal(Math.fround(x), Math.fround(0.7548776662466927))
  assert.equal(Math.fround(y), Math.fround(0.5698402909980532))
})
