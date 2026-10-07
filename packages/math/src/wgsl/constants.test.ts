import test from 'node:test'
import assert from 'node:assert/strict'
import { FINITE_SENTINEL, FAR_VALUE, GOLDEN_U32, INFINITE_THRESHOLD } from './constants.ts'
import { FINITE_SENTINEL as FINITE, FLOAT32_MAX, GOLDEN_FRACTION } from '../constants.ts'

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

test('the 32-bit golden salt is the golden fraction in 32 bits, odd', () => {
  assert.equal(GOLDEN_U32.text, 'const GOLDEN_U32:u32=0x9e3779b9u;')
  const word = literal(GOLDEN_U32.text)
  assert.equal(word, Math.floor(GOLDEN_FRACTION * 2 ** 32))
  assert.equal(word % 2, 1)
})
