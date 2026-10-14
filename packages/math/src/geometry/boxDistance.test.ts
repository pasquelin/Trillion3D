import test from 'node:test'
import assert from 'node:assert/strict'
import { boxPointDistance, boxPointReach } from './boxDistance.ts'

test('boxPointDistance: 0 inside, the gap past a face, the root of the gaps past a corner', () => {
  const box = [0, 0, 0, 1, 1, 1]
  assert.equal(boxPointDistance(box, 0, 0.5, 0.5, 0.5), 0)
  assert.equal(boxPointDistance(box, 0, 3, 0.5, 0.5), 2)
  // Gaps 2, 3, 6 past the corner (1, 1, 1): a quadruple, the root exact.
  assert.equal(boxPointDistance(box, 0, 3, 4, 7), 7)
  assert.equal(boxPointDistance(box, 0, -2, -3, -6), 7)
})

test('boxPointReach: the farthest corner, inside the box or out', () => {
  const box = [0, 0, 0, 1, 1, 1]
  // Inside at (0.25, 0.25, 0.25): the corner (1, 1, 1), 0.75 on each axis.
  assert.equal(boxPointReach(box, 0, 0.25, 0.25, 0.25), Math.sqrt(3 * 0.75 * 0.75))
  // Outside at (3, 4, 7): the corner (0, 0, 0), a quadruple 3, 4, 12 → 13.
  assert.equal(boxPointReach(box, 0, 3, 4, 12), 13)
})
