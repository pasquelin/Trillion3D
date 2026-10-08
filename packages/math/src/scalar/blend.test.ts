// reals.ts mix and smoothstep: against exact rational values on dyadic inputs, where
// every operation is exact, and the forms the sites write, bit for bit.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lerp, mix, smoothstep } from './reals.ts'
import { haltonSpan } from '../sequence/sweep.fixture.ts'

test('mix is a·(1 − t) + b·t, exact at both ends, another rounding than lerp', () => {
  // On multiples of 1/256 with small numerators every product and sum is exact: the rational blend.
  for (let a = -8; a <= 8; a += 3)
    for (let b = -8; b <= 8; b += 5)
      for (let t = 0; t <= 256; t += 32) {
        const exact = BigInt(a) * BigInt(256 - t) + BigInt(b) * BigInt(t)
        assert.equal(mix(a, b, t / 256), Number(exact) / 256, `${a} ${b} ${t}`)
      }
  assert.equal(mix(0.3, 0.9, 1), 0.9)
  assert.equal(mix(0.3, 0.9, 0), 0.3)
  // lerp misses its end where mix lands on it: two orders, two functions.
  assert.notEqual(lerp(0.3, 0.9, 1), 0.9)
  assert.ok(Number.isNaN(mix(NaN, 1, 0.5)))
})

test('the sample blend writes mix: values[i]·(1 − w) + values[j]·w', () => {
  for (let k = 0; k < 2000; k++) {
    const a = haltonSpan(k, 2, -50, 50),
      b = haltonSpan(k, 3, -50, 50),
      w = haltonSpan(k, 5, 0, 1)
    assert.ok(Object.is(mix(a, b, w), a * (1 - w) + b * w), `${k}`)
  }
})

test('smoothstep is 3t² − 2t³: exact on dyadic t, symmetric, flat at the ends', () => {
  for (let i = 0; i <= 1024; i++) {
    const t = BigInt(i)
    // 3t² − 2t³ over 1024³.
    const exact = 3n * t * t * 1024n - 2n * t * t * t
    assert.equal(smoothstep(i / 1024), Number(exact) / 1024 ** 3, `${i}`)
  }
  assert.equal(smoothstep(0), 0)
  assert.equal(smoothstep(1), 1)
  assert.equal(smoothstep(0.5), 0.5)
  for (let i = 0; i <= 64; i++) assert.equal(smoothstep(1 - i / 64), 1 - smoothstep(i / 64))
})
