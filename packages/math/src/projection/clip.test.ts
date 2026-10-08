// clip.ts clipWindowMatrix4: the window transform of clip space applied to a matrix — the full
// product by value, the depth rows bit for bit, the jitter loop it replaces bit for bit.
import assert from 'node:assert/strict'
import test from 'node:test'
import { clipWindowMatrix4 } from './clip.ts'
import { multiplyMatrix4 } from '../matrix/matrix4.ts'
import { transformHomogeneousPoint } from '../vector/vector.ts'
import { HALTON_SWEEP, haltonSpan } from '../sequence/sweep.fixture.ts'

const sweepMatrix = (i: number) =>
  Float64Array.from({ length: 16 }, (_, k) => haltonSpan(i + k * 131, 2 + (k % 4), -50, 50))

test('clipWindowMatrix4 is W · m by value, its depth rows m bit for bit, in place too', () => {
  const window = new Float64Array(16),
    product = new Float64Array(16),
    out = new Float64Array(16)
  for (let i = 1; i <= HALTON_SWEEP; i += 4) {
    const m = sweepMatrix(i),
      sx = haltonSpan(i, 7, -3, 3),
      sy = haltonSpan(i, 11, -3, 3),
      ox = haltonSpan(i, 13, -1, 1),
      oy = haltonSpan(i, 17, -1, 1)
    window.set([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, ox, oy, 0, 1])
    multiplyMatrix4(product, window, m)
    clipWindowMatrix4(out, m, sx, sy, ox, oy)
    for (let k = 0; k < 16; k++) {
      assert.ok(out[k] === product[k], `product ${i}.${k}: ${out[k]} vs ${product[k]}`)
      if (k % 4 >= 2) assert.ok(Object.is(out[k], m[k]), `depth row ${i}.${k}`)
    }
    const same = Float64Array.from(m)
    assert.equal(clipWindowMatrix4(same, same, sx, sy, ox, oy), same)
    for (let k = 0; k < 16; k++) assert.ok(Object.is(same[k], out[k]), `in place ${i}.${k}`)
  }
})

test('clipWindowMatrix4 at unit scale is the TAA jitter loop, bit for bit', () => {
  const out = new Float64Array(16),
    old = new Float64Array(16)
  for (let i = 1; i <= HALTON_SWEEP; i += 4) {
    const vp = sweepMatrix(i),
      width = 1 + Math.floor(haltonSpan(i, 3, 0, 4096)),
      height = 1 + Math.floor(haltonSpan(i, 5, 0, 4096))
    const dx = (2 * haltonSpan(i, 2, -0.5, 0.5)) / width,
      dy = (2 * haltonSpan(i, 3, -0.5, 0.5)) / height
    for (let column = 0; column < 4; column++) {
      const at = column * 4,
        w = vp[at + 3]
      old[at] = vp[at] + dx * w
      old[at + 1] = vp[at + 1] + dy * w
      old[at + 2] = vp[at + 2]
      old[at + 3] = w
    }
    clipWindowMatrix4(out, vp, 1, 1, dx, dy)
    for (let k = 0; k < 16; k++) assert.ok(Object.is(out[k], old[k]), `${i}.${k}`)
  }
})

test('clipWindowMatrix4 moves a projected point by the window: x·sx + ox·w, y·sy + oy·w', () => {
  const m = sweepMatrix(1),
    out = clipWindowMatrix4(new Float64Array(16), m, 0.5, 2, 0.25, -0.75),
    before = new Float64Array(4),
    after = new Float64Array(4)
  transformHomogeneousPoint(before, m, 1, -2, 3)
  transformHomogeneousPoint(after, out, 1, -2, 3)
  const [x, y, z, w] = before
  assert.ok(Math.abs(after[0] - (x * 0.5 + 0.25 * w)) <= 1e-12 * Math.abs(w))
  assert.ok(Math.abs(after[1] - (y * 2 - 0.75 * w)) <= 1e-12 * Math.abs(w))
  assert.deepEqual([after[2], after[3]], [z, w])
})
