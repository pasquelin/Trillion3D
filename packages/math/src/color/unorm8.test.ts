// color.ts unorm8 and fromUnorm8: a unit value to its byte and back, over every byte; the sRGB
// byte on unorm8 is the old body bit for bit.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fromUnorm8, linearToSrgb, linearToSrgb8, unorm8 } from './color.ts'
import { fract } from '../scalar/reals.ts'
import { HALTON_SWEEP, haltonSpan } from '../sequence/sweep.fixture.ts'

test('unorm8 takes back every byte fromUnorm8 gives, and rounds half a byte away', () => {
  for (let b = 0; b <= 255; b++) {
    assert.equal(unorm8(fromUnorm8(b)), b)
    // Within a third of a byte either side, the same byte.
    assert.equal(unorm8((b + 0.3) / 255), b, `${b}+`)
    assert.equal(unorm8((b - 0.3) / 255), Math.max(b, 0), `${b}-`)
  }
  assert.deepEqual([fromUnorm8(0), fromUnorm8(255)], [0, 1])
  assert.deepEqual([unorm8(-2), unorm8(0.5), unorm8(7)], [0, 128, 255])
  assert.ok(Number.isNaN(unorm8(NaN)))
})

test('unorm8 is the old sRGB byte and the blue-noise byte, bit for bit', () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const c = haltonSpan(i, 2, -0.1, 1.2)
    assert.equal(linearToSrgb8(c), Math.min(255, Math.max(0, Math.round(linearToSrgb(c) * 255))))
    const v = haltonSpan(i, 3, -4, 4)
    assert.equal(unorm8(fract(v)), Math.round((v - Math.floor(v)) * 255), `${i}`)
  }
})
