import assert from 'node:assert/strict'
import test from 'node:test'
import { sphereFromBounds, spheresOverlap } from './sphere.ts'

test('sphereFromBounds: the midpoint and half the diagonal; an empty box gives radius −1', () => {
  const out = new Float64Array(5)
  // Sides 2, 3, 6: the diagonal is 7.
  sphereFromBounds(out, 1, -1, 0, 1, 1, 3, 7)
  assert.deepEqual([...out], [0, 0, 1.5, 4, 3.5])
  sphereFromBounds(out, 1, 1, 0, 0, 0, 1, 1)
  assert.deepEqual([...out], [0, 0, 0, 0, -1])
})

test('spheresOverlap: centres 5 apart, radii 2 and 3 touch, 2 and 2.9 do not', () => {
  const a = [0, 0, 0],
    b = [9, 3, 4, 0]
  assert.equal(spheresOverlap(a, 2, b, 3, 0, 1), true)
  assert.equal(spheresOverlap(a, 2, b, 2.9, 0, 1), false)
  assert.equal(spheresOverlap(b, 3, a, 2, 1, 0), true)
})
