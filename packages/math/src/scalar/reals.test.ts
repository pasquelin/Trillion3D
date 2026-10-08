// reals.ts fract, floorMod, lerpArray and snap, quantile.ts median, quantileFloor and mean: exact values, NaN and negatives, and
// the expressions they replace bit for bit.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decayFactor, decayRate, floorMod, fract, lerp, lerpArray, snap, wrap } from './reals.ts'
import {
  mean,
  median,
  medianOf,
  quantile,
  quantileFloor,
  quantileFloorOf,
  quantileOf,
} from './quantile.ts'
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

test('snap: the nearest multiple of the step, the expression it replaces bit for bit', () => {
  assert.equal(snap(13, 8), 16)
  assert.equal(snap(12, 8), 16)
  assert.equal(snap(-12, 8), -8)
  assert.ok(Object.is(snap(-1, 8), -0))
  assert.ok(Number.isNaN(snap(NaN, 8)) && Number.isNaN(snap(1, 0)))
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const value = haltonSpan(i, 2, -1e4, 1e4),
      step = haltonSpan(i, 3, 1e-3, 90)
    assert.ok(Object.is(snap(value, step), Math.round(value / step) * step), `${i}`)
    // A power-of-two step divides and multiplies exactly: the `2 ** 20` grid written by hand.
    assert.ok(Object.is(snap(value, 2 ** -20), Math.round(value * 2 ** 20) / 2 ** 20), `${i}`)
  }
})

test('quantileFloor and mean: the floor rank and the left-to-right sum, the forms they replace', () => {
  assert.equal(quantileFloor([1, 2, 3, 4], 0.5), 3)
  assert.equal(quantileFloor([1, 2, 3, 4], 1), 4)
  assert.equal(quantileFloor([], 0.5), undefined)
  assert.ok(Number.isNaN(mean([])))
  for (let n = 1; n <= 64; n++) {
    const list = Array.from({ length: n }, (_, k) => haltonSpan(n * 64 + k, 5, -1e3, 1e3)).sort(
      (a, b) => a - b,
    )
    assert.ok(Object.is(quantileFloor(list, 0.5), list[n >> 1]), `${n}`)
    assert.ok(Object.is(quantileFloor(list, 0.95), list[Math.floor(n * 0.95)]), `${n}`)
    assert.ok(Object.is(mean(list), list.reduce((a, b) => a + b, 0) / n), `${n}`)
    assert.ok(
      Object.is(
        mean(Float32Array.from(list)),
        Float32Array.from(list).reduce((a, b) => a + b, 0) / n,
      ),
    )
  }
})

test('quantileOf, medianOf, quantileFloorOf: the sorted rank of an unsorted list, which stays as it was', () => {
  const values = [9, 1, 5, 3, 7, 2]
  const sorted = [1, 2, 3, 5, 7, 9]
  assert.equal(quantileOf(values, 0.95), quantile(sorted, 0.95))
  assert.equal(medianOf(values), median(sorted))
  assert.equal(quantileFloorOf(values, 0.5), quantileFloor(sorted, 0.5))
  assert.equal(quantileFloorOf([], 0.5), undefined)
  assert.deepEqual(values, [9, 1, 5, 3, 7, 2])
})

test('decayRate and decayFactor: the exponential decay, the factor of the rate returning the share left', () => {
  assert.equal(decayRate(0.5, 2), -Math.log(0.5) / 2)
  assert.equal(decayFactor(3, 0.25), Math.exp(-3 * 0.25))
  assert.ok(Math.abs(decayFactor(decayRate(0.01, 0.3), 0.3) - 0.01) < 1e-15)
})
