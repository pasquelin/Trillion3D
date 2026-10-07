import assert from 'node:assert/strict'
import test from 'node:test'
import {
  boxCenter,
  boxContainsPoint,
  boxEmpty,
  boxesOverlap,
  boxFromPoints,
  boxPointDistance,
} from './box.ts'

test('boxCenter: the midpoint of each pair of bounds, at the offset', () => {
  const out = new Float64Array(4)
  boxCenter(out, 1, -1, 2, 4, 3, 6, 10)
  assert.deepEqual([...out], [0, 1, 4, 7])
})

test('boxContainsPoint: inside and on a face true, outside false, a NaN counts as inside', () => {
  const box = [9, -1, -1, -1, 1, 1, 1]
  assert.equal(boxContainsPoint(box, 1, 0, 0.5, -0.5), true)
  assert.equal(boxContainsPoint(box, 1, 1, -1, 0), true)
  assert.equal(boxContainsPoint(box, 1, 1.5, 0, 0), false)
  assert.equal(boxContainsPoint(box, 1, 0, 0, -2), false)
  assert.equal(boxContainsPoint(box, 1, NaN, 0, 0), true)
})

test('boxesOverlap: touching faces overlap, disjoint boxes do not, an empty box overlaps nothing', () => {
  const a = [0, 0, 0, 1, 1, 1]
  assert.equal(boxesOverlap(a, 0, [7, 1, 0, 0, 2, 1, 1], 1), true)
  assert.equal(boxesOverlap(a, 0, [1.5, 0, 0, 2, 1, 1], 0), false)
  assert.equal(boxesOverlap(a, 0, [0.2, 0.2, 2, 0.8, 0.8, 3], 0), false)
  const empty = new Float64Array(6)
  boxEmpty(empty, 0)
  assert.equal(boxesOverlap(empty, 0, a, 0), false)
  assert.equal(boxesOverlap(a, 0, empty, 0), false)
})

test('boxFromPoints: strided points from an offset, the bounds of the ones counted', () => {
  // Stride 4: the fourth number of each point, and the points past `count`, are not read.
  const points = [99, 1, 5, -2, 100, -3, 0, 4, 100, 2, 7, 1, 100, -50, -50, -50]
  const out = new Float64Array(7).fill(42)
  boxFromPoints(out, 1, points, 1, 3, 4)
  assert.deepEqual([...out], [42, -3, 0, -2, 2, 7, 4])
})

test('boxFromPoints: −0 sits below +0, a NaN makes its bounds NaN, no point leaves the box empty', () => {
  const out = new Float64Array(6)
  boxFromPoints(out, 0, [0, 0, 0, -0, -0, -0], 0, 2)
  assert.ok(Object.is(out[0], -0) && Object.is(out[3], 0))
  boxFromPoints(out, 0, [1, NaN, 2, 3, 4, 5], 0, 2)
  assert.ok(Number.isNaN(out[1]) && Number.isNaN(out[4]))
  assert.deepEqual([out[0], out[3], out[2], out[5]], [1, 3, 2, 5])
  boxFromPoints(out, 0, [], 0, 0)
  assert.deepEqual([...out], [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity])
})

test('boxPointDistance: 0 inside, the gap past a face, the root of the gaps past a corner', () => {
  const box = [0, 0, 0, 1, 1, 1]
  assert.equal(boxPointDistance(box, 0, 0.5, 0.5, 0.5), 0)
  assert.equal(boxPointDistance(box, 0, 3, 0.5, 0.5), 2)
  // Gaps 2, 3, 6 past the corner (1, 1, 1): a quadruple, the root exact.
  assert.equal(boxPointDistance(box, 0, 3, 4, 7), 7)
  assert.equal(boxPointDistance(box, 0, -2, -3, -6), 7)
})
