import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextPow2 } from './integers.ts'

test('nextPow2 is exact on its whole domain: each power, either side of it, and reals', () => {
  for (let k = 1; k <= 32; k++) {
    const p = 2 ** k
    assert.equal(nextPow2(p), p, `2^${k}`)
    assert.equal(nextPow2(p - 1), k === 1 ? 1 : p, `2^${k} − 1`)
    assert.equal(nextPow2(p / 2 + 1), p, `2^${k - 1} + 1`)
    assert.equal(nextPow2(p - 0.5), p, `2^${k} − 0.5`)
    assert.equal(nextPow2(p / 2 + 2 ** -20), p, `just past 2^${k - 1}`)
  }
  // The logarithm form rounded 2^31 + 1 and 2^32 − 1 to their power of two below.
  assert.equal(nextPow2(2 ** 32 - 1), 2 ** 32)
  assert.equal(nextPow2(2 ** 31 + 1), 2 ** 32)
  assert.equal(nextPow2(1 + 2 ** -52), 2)
})

test('nextPow2 outside its domain: 1 up to 1, NaN for NaN, a throw past 2^32', () => {
  for (const v of [-Infinity, -5, -0, 0, 2 ** -1074, 0.5, 1]) assert.equal(nextPow2(v), 1, `${v}`)
  assert.ok(Number.isNaN(nextPow2(NaN)))
  for (const v of [2 ** 32 + 1, 2 ** 50 + 1, Infinity]) assert.throws(() => nextPow2(v), RangeError)
})
