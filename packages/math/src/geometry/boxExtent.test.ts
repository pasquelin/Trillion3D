// box.ts boundsDiagonal, boxDiagonal, boxRadius: Pythagorean boxes whose
// diagonals are whole, the radius sphereFromBounds writes bit for bit, the forms the sites write,
// and the half extents against the eight transformed corners.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boundsDiagonal, boxDiagonal, boxRadius } from './box.ts'
import { sphereFromBounds } from './sphere.ts'
import { length3 } from '../vector/vector.ts'
import { haltonSpan } from '../sequence/sweep.fixture.ts'

test('the diagonal of a box of sides 2, 3, 6 is 7, of sides 1, 4, 8 is 9; the radius half', () => {
  assert.equal(boundsDiagonal(-1, 0, 1, 1, 3, 7), 7)
  const boxes = [9, 9, -1, 0, 1, 1, 3, 7, 5, 5, 5, 6, 9, 13]
  assert.equal(boxDiagonal(boxes, 2), 7)
  assert.equal(boxRadius(boxes, 2), 3.5)
  assert.equal(boxDiagonal(boxes, 8), 9)
  assert.equal(boxDiagonal([0, 0, 0, 3, 4, 0]), 5)
  assert.equal(boxRadius([0, 0, 0, 0, 0, 0]), 0)
  assert.ok(Number.isNaN(boxDiagonal([0, 0, 0, NaN, 1, 1])))
})

test('boxRadius is the radius sphereFromBounds writes, and the sites spell it alike', () => {
  const sphere = new Float64Array(4)
  for (let k = 0; k < 3000; k++) {
    const lo = [haltonSpan(k, 2, -1e3, 1e3), haltonSpan(k, 3, -1e3, 1e3), haltonSpan(k, 5, -1, 1)]
    const box = [...lo, lo[0] + haltonSpan(k, 7, 0, 50), lo[1] + haltonSpan(k, 11, 0, 5e3), lo[2]]
    sphereFromBounds(sphere, 0, box[0], box[1], box[2], box[3], box[4], box[5])
    assert.ok(Object.is(boxRadius(box), sphere[3]), `${k}`)
    const d = length3(box[3] - box[0], box[4] - box[1], box[5] - box[2])
    assert.ok(Object.is(boxDiagonal(box), d), `${k}`)
    assert.ok(Object.is(boxRadius(box), 0.5 * d), `${k}`)
  }
})
