// hermite.ts: the span's endpoints and the basis weights, the expressions they replace bit for bit.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hermiteBasis, splineSpan } from './hermite.ts'

test('splineSpan: b at w = 0, c at w = 1, the written operations in order', () => {
  assert.equal(splineSpan(1, 2, 5, 9, 0, 0, 0), 2)
  assert.equal(splineSpan(1, 2, 5, 9, 1, 1, 1), 5)
  const [a, b, c, d, w] = [0.3, 1.7, -2.9, 4.1, 0.37]
  const w2 = w * w,
    w3 = w2 * w
  const u = (c - a) * 0.5,
    v = (d - b) * 0.5
  const k = 2 * b - 2 * c + u + v,
    q = 3 * c - 3 * b - 2 * u - v
  assert.equal(splineSpan(a, b, c, d, w, w2, w3), k * w3 + q * w2 + u * w + b)
})

test('hermiteBasis: the four weights as written, 1 0 0 0 at w = 0 and 0 0 1 0 at w = 1', () => {
  const out = new Float64Array(4)
  assert.deepEqual([...hermiteBasis(out, 0)], [1, 0, 0, 0])
  assert.deepEqual([...hermiteBasis(out, 1)], [0, 0, 1, 0])
  const w = 0.4137,
    w2 = w * w,
    w3 = w2 * w
  assert.deepEqual(
    [...hermiteBasis(out, w)],
    [2 * w3 - 3 * w2 + 1, w3 - 2 * w2 + w, -2 * w3 + 3 * w2, w3 - w2],
  )
})
