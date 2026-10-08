// matrixElements.ts: sixteen numbers compared bit for bit — the sign of a zero tells two
// translations apart, a NaN left in place is no change — or by value.
import test from 'node:test'
import assert from 'node:assert/strict'
import { sameElements, sameMatrixBits, sameMatrixFloat32 } from './matrixElements.ts'

test('sameMatrixBits tells the sign of a zero and keeps a NaN equal to itself; sameElements merges both', () => {
  const held = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, NaN, 0, 0, 1]
  const now = held.slice()
  assert.equal(sameMatrixBits(held, now), true, 'a NaN left in place is no change')
  now[13] = -0
  assert.equal(sameMatrixBits(held, now), false, '-0 is not 0')
  now[12] = held[12] = 0
  assert.equal(sameElements(held, now), true, 'by value, -0 is 0')
})

test('sameMatrixFloat32: a double that rounds to the held float32 matches, one step off does not', () => {
  const now = Float64Array.from({ length: 16 }, (_, k) => 0.1 * (k + 1))
  const held = new Float32Array(20)
  held.set(now, 4)
  assert.equal(sameMatrixFloat32(held, now, 4), true)
  assert.equal(sameMatrixFloat32(held, now), false, 'read at its offset')
  // 0.1 · 2^-30 below a float32 half step moves no float32; one float32 step moves it.
  now[0] += 0.1 * 2 ** -30
  assert.equal(sameMatrixFloat32(held, now, 4), true)
  now[0] = held[4] * (1 + 2 ** -23)
  assert.equal(sameMatrixFloat32(held, now, 4), false)
  now[0] = held[4]
  held[5] = 0
  now[1] = -0
  assert.equal(sameMatrixFloat32(held, now, 4), true, 'by value, -0 is 0')
  now[1] = held[5] = NaN
  assert.equal(sameMatrixFloat32(held, now, 4), false, 'a NaN never matches')
})
