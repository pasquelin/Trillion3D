// box.ts boundsDiagonal, boxDiagonal, boxRadius and transformHalfExtent: Pythagorean boxes whose
// diagonals are whole, the radius sphereFromBounds writes bit for bit, the forms the sites write,
// and the half extents against the eight transformed corners.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boundsDiagonal, boxDiagonal, boxRadius, boxTransform, transformHalfExtent } from './box.ts'
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

test('transformHalfExtent bounds the eight corners of the box it carries, and meets them', () => {
  const box = new Float64Array(6),
    image = new Float64Array(6),
    half = new Float64Array(3)
  for (let k = 0; k < 500; k++) {
    // A rotation about z by a turn, a shear and a scale, translated: the linear part read alone.
    const angle = haltonSpan(k, 2, -Math.PI, Math.PI),
      c = Math.cos(angle),
      s = Math.sin(angle),
      shear = haltonSpan(k, 3, -1, 1),
      scale = haltonSpan(k, 5, 0.25, 4)
    const m = [c, s, 0, 0, -s, c, 0, 0, shear, 0, scale, 0, 7, -3, 11, 1]
    box.set([-1, -2, -0.5, 1, 2, 0.5])
    boxTransform(image, 0, box, 0, m)
    transformHalfExtent(half, 0, m, 1, 2, 0.5)
    for (let axis = 0; axis < 3; axis++) {
      const centre = m[12 + axis]
      // The carried box's centre is the translation; its half extent is the corners' reach.
      const reach = Math.max(image[axis + 3] - centre, centre - image[axis])
      assert.ok(Math.abs(half[axis] - reach) <= 1e-12 * (1 + reach), `${k} ${axis}`)
    }
  }
  const out = transformHalfExtent([9, 9, 9, 9], 1, [-2, 0, 0, 0, 0, 3, 0, 0, 0, 0, -4, 0], 1, 1, 1)
  assert.deepEqual(out, [9, 2, 3, 4])
})
