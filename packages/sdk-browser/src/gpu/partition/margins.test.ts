import test from 'node:test'
import assert from 'node:assert/strict'
import { DEPTH_GROW, ERR_K, INPUT_K, SCREEN_SLACK_K, wgslFloat } from './margins.ts'

/** The `f32` a WGSL compiler reads from a literal: the single-precision value nearest it. */
const parsed = (literal: string) => Math.fround(Number.parseFloat(literal))

test('each margin reaches the shader as the f32 nearest its value', () => {
  for (const value of [DEPTH_GROW, ERR_K, 2 * ERR_K, INPUT_K, SCREEN_SLACK_K, 0, 1])
    assert.equal(parsed(wgslFloat(value)), Math.fround(value), `${value}`)
})

test('the depth margin is the two ulps it declares, not one', () => {
  // (1 + 2^-23)(1 + 2^-24) lies above the midpoint of 1 + 2^-23 and 1 + 2^-22.
  assert.equal(parsed(wgslFloat(DEPTH_GROW)), 1 + 2 ** -22)
})

test('a value just above an f32 midpoint keeps its side', () => {
  for (let k = 10; k < 40; k++) {
    const value = 1 + 1.5 * 2 ** -23 + 2 ** -23 * 2 ** -k
    assert.equal(parsed(wgslFloat(value)), Math.fround(value), `2^-${k} above the midpoint`)
  }
})

test('a literal is a WGSL float literal', () => {
  for (const value of [0, 1, 2, DEPTH_GROW, ERR_K, 1e10])
    assert.match(wgslFloat(value), /^\d+\.\d*(e[+-]?\d+)?$|^\d+(\.\d*)?e[+-]?\d+$/)
})
