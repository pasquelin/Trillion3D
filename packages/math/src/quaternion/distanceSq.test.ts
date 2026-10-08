// quaternion.ts distanceSqQuaternion and singular.ts linearPartIdentityDistanceSq: exact integer
// cases, and the loops the sites write, bit for bit.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { distanceSqQuaternion } from './quaternion.ts'
import { linearPartIdentityDistanceSq } from '../matrix/singular.ts'
import { haltonSpan } from '../sequence/sweep.fixture.ts'

test('distanceSqQuaternion: the squared gap of two four-vectors, at their offsets', () => {
  assert.equal(distanceSqQuaternion([1, 2, 3, 4], [1, 2, 3, 4]), 0)
  // (1, 2, 2, 4): 1 + 4 + 4 + 16.
  assert.equal(distanceSqQuaternion([9, 0, 0, 0, 0], [1, 2, 2, 4], 1), 25)
  assert.equal(distanceSqQuaternion([1, 2, 2, 4], [8, 0, 0, 0, 0], 0, 1), 25)
  assert.ok(Number.isNaN(distanceSqQuaternion([NaN, 0, 0, 0], [0, 0, 0, 0])))
})

test('the track segment’s chord loop is distanceSqQuaternion, bit for bit', () => {
  for (let k = 0; k < 3000; k++) {
    const a = [2, 3, 5, 7].map((base, c) => haltonSpan(k * 4 + c + 1, base, -1, 1))
    const b = [3, 5, 7, 2].map((base, c) => haltonSpan(k * 4 + c + 1, base, -1, 1))
    let chord = 0
    for (let c = 0; c < 4; c++) chord += (b[c] - a[c]) ** 2
    assert.ok(Object.is(distanceSqQuaternion(a, b), chord), `${k}`)
  }
})

test('linearPartIdentityDistanceSq: zero at the identity, the sum of squared gaps elsewhere', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]
  assert.equal(linearPartIdentityDistanceSq(identity), 0)
  // Scale 3 on x, then 1 off the diagonal in the second column: 2² + 1².
  const m = [0, 0, 3, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0]
  assert.equal(linearPartIdentityDistanceSq(m, 2), 5)
  // Every term off: the nine squared gaps.
  const n = [2, 3, 4, 9, 5, 6, 7, 9, 8, 9, 10, 9]
  assert.equal(linearPartIdentityDistanceSq(n), 1 + 9 + 16 + 25 + 25 + 49 + 64 + 81 + 81)
})

test('the skeleton’s palette loop is linearPartIdentityDistanceSq, bit for bit', () => {
  for (let k = 0; k < 2000; k++) {
    const palette = Array.from({ length: 20 }, (_, i) =>
      haltonSpan(k * 20 + i + 1, [2, 3, 5, 7][i % 4], -2, 2),
    )
    const m = 4
    let frobenius = 0
    for (let row = 0; row < 3; row++) {
      const x = palette[m + row * 4],
        y = palette[m + row * 4 + 1],
        z = palette[m + row * 4 + 2]
      frobenius += (x - +(row === 0)) ** 2 + (y - +(row === 1)) ** 2 + (z - +(row === 2)) ** 2
    }
    assert.ok(Object.is(linearPartIdentityDistanceSq(palette, m), frobenius), `${k}`)
  }
})
