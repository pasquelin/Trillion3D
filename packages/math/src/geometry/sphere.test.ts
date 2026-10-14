import assert from 'node:assert/strict'
import test from 'node:test'
import { sphereFromBounds } from './sphere.ts'

test('sphereFromBounds: the midpoint and half the diagonal; an empty box gives radius −1', () => {
  const out = new Float64Array(5)
  // Sides 2, 3, 6: the diagonal is 7.
  sphereFromBounds(out, 1, -1, 0, 1, 1, 3, 7)
  assert.deepEqual([...out], [0, 0, 1.5, 4, 3.5])
  sphereFromBounds(out, 1, 1, 0, 0, 0, 1, 1)
  assert.deepEqual([...out], [0, 0, 0, 0, -1])
})
