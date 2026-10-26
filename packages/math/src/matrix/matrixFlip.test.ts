// matrix4.ts negateColumnMatrix4 and negateRowMatrix4: a matrix times a one-axis flip, on either
// side — against the product by the flip.
import assert from 'node:assert/strict'
import test from 'node:test'
import { multiplyMatrix4, negateColumnMatrix4, negateRowMatrix4 } from './matrix4.ts'
import { haltonSpan } from '../sequence/sweep.fixture.ts'

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

test('a zero flips to −0, and back, in place', () => {
  const same = new Float64Array(16)
  assert.equal(negateRowMatrix4(same, same, 3), same)
  assert.ok(Object.is(same[3], -0) && Object.is(same[15], -0) && Object.is(same[2], 0))
})
