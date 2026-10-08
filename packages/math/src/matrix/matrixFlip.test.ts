// matrix4.ts negateColumnMatrix4 and negateRowMatrix4: a matrix times a one-axis flip, on either
// side — against the product by the flip, and the copy-and-negate loops they replace.
import assert from 'node:assert/strict'
import test from 'node:test'
import { multiplyMatrix4, negateColumnMatrix4, negateRowMatrix4 } from './matrix4.ts'
import { HALTON_SWEEP, haltonSpan } from '../sequence/sweep.fixture.ts'

/** The diagonal flip of axis `axis`, column-major. */
const flip = (axis: number) => {
  const d = new Float64Array(16)
  for (let k = 0; k < 4; k++) d[5 * k] = k === axis ? -1 : 1
  return d
}

const sweepMatrix = (i: number) =>
  Float64Array.from({ length: 16 }, (_, k) => haltonSpan(i + k * 257, 2 + (k % 3), -1e3, 1e3))

test('negateColumnMatrix4 is m · flip, negateRowMatrix4 flip · m, by value', () => {
  const product = new Float64Array(16),
    out = new Float64Array(16)
  for (let i = 1; i <= 512; i++) {
    const m = sweepMatrix(i)
    for (let axis = 0; axis < 4; axis++) {
      multiplyMatrix4(product, m, flip(axis))
      negateColumnMatrix4(out, m, axis)
      for (let k = 0; k < 16; k++) assert.ok(out[k] === product[k], `column ${i}.${axis}.${k}`)
      multiplyMatrix4(product, flip(axis), m)
      negateRowMatrix4(out, m, axis)
      for (let k = 0; k < 16; k++) assert.ok(out[k] === product[k], `row ${i}.${axis}.${k}`)
    }
  }
})

test('the flips are the loops they replace, bit for bit, in place and into float32', () => {
  for (let i = 1; i <= HALTON_SWEEP; i += 8) {
    const m = sweepMatrix(i)
    m[3] = 0
    m[7] = -0
    // The clip-z flip of a projection: its third column negated, into a float32 buffer.
    const old32 = new Float32Array(16)
    for (let k = 0; k < 16; k++) old32[k] = m[k]
    for (let r = 0; r < 4; r++) old32[8 + r] = -m[8 + r]
    const new32 = negateColumnMatrix4(new Float32Array(16), m, 2)
    for (let k = 0; k < 16; k++) assert.ok(Object.is(new32[k], old32[k]), `column ${i}.${k}`)
    // The view's z row negated in place.
    const old = Float64Array.from(m)
    for (let k = 2; k < 16; k += 4) old[k] = -old[k]
    const same = Float64Array.from(m)
    assert.equal(negateRowMatrix4(same, same, 2), same)
    for (let k = 0; k < 16; k++) assert.ok(Object.is(same[k], old[k]), `row ${i}.${k}`)
  }
  // A zero flips to −0, and back.
  const zeros = negateRowMatrix4(new Float64Array(16), new Float64Array(16), 3)
  assert.ok(Object.is(zeros[3], -0) && Object.is(zeros[15], -0) && Object.is(zeros[2], 0))
})
