// reals.ts fract, floorMod and lerpArray, quantile.ts median: exact values, NaN and negatives, and
// the expressions they replace bit for bit.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { floorMod, fract, lerp, lerpArray, wrap } from './reals.ts'
import { median } from './quantile.ts'
import { edgeValues, HALTON_SWEEP, haltonSpan } from '../sequence/sweep.fixture.ts'

test('fract: the part above the floor, negatives counted from below, NaN through', () => {
  assert.equal(fract(2.75), 0.75)
  assert.equal(fract(-2.75), 0.25)
  assert.equal(fract(3), 0)
  assert.equal(fract(-0.5), 0.5)
  // A negative below half an ulp of 1 rounds up to 1.
  assert.equal(fract(-1e-17), 1)
  assert.ok(Number.isNaN(fract(NaN)) && Number.isNaN(fract(Infinity)))
})

test('floorMod: the sign of the divisor, the sampler fold, and wrap on a positive divisor', () => {
  assert.equal(floorMod(7, 3), 1)
  assert.equal(floorMod(-7, 3), 2)
  assert.equal(floorMod(7, -3), -2)
  assert.equal(floorMod(-1.5, 2), 0.5)
  assert.ok(Number.isNaN(floorMod(NaN, 2)) && Number.isNaN(floorMod(1, 0)))
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const t = haltonSpan(i, 2, -40, 40)
    // The sampler's mirror fold over two periods.
    assert.ok(Object.is(floorMod(t, 2), t - 2 * Math.floor(t / 2)), `${i}`)
    // Exact on integers, where the two forms cannot round apart.
    const k = Math.round(t * 1000)
    assert.equal(floorMod(k, 7), wrap(k, 7), `${k}`)
  }
})

test('lerpArray: each element lerped, t = 1 an exact copy, into float32 too', () => {
  const from = [0.7, -3, 1e9],
    to = [0.1, 5, -1e-9]
  const out = lerpArray(new Float64Array(3), from, to, 0.25)
  for (let k = 0; k < 3; k++) assert.ok(Object.is(out[k], lerp(from[k], to[k], 0.25)), `${k}`)
  assert.deepEqual([...lerpArray(new Float64Array(3), from, to, 1)], to)
  // 0.7 + (0.1 − 0.7) · 1 misses 0.1 by a rounding: the copy does not.
  assert.notEqual(lerp(0.7, 0.1, 1), 0.1)
  assert.deepEqual([...lerpArray(new Float64Array(3), from, to, 0)], from)
  const single = lerpArray(new Float32Array(2), [1, 2], [3, 6], 0.5)
  assert.deepEqual([...single], [2, 4])
  assert.ok(lerpArray(new Float64Array(1), [NaN], [1], 0.5).every(Number.isNaN))
})

test('median: odd and even lengths, the old body bit for bit', () => {
  assert.equal(median([4]), 4)
  assert.equal(median([1, 2, 9]), 2)
  assert.equal(median([1, 2, 4, 9]), 3)
  assert.equal(median(Float64Array.of(-3, -1)), -2)
  const old = (t: number[]) => {
    const middle = t.length >> 1
    return t.length % 2 ? t[middle] : (t[middle - 1] + t[middle]) / 2
  }
  for (let n = 1; n <= 64; n++) {
    const list = Array.from({ length: n }, (_, k) => haltonSpan(n * 64 + k, 3, -5, 5)).sort(
      (a, b) => a - b,
    )
    assert.ok(Object.is(median(list), old(list)), `${n}`)
  }
  // The edges of [−1, 1] are symmetric, both zeros in the middle: the median is +0.
  assert.equal(median(edgeValues(-1, 1).sort((a, b) => a - b)), 0)
})
