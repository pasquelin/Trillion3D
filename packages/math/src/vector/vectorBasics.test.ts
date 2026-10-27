import test from 'node:test'
import assert from 'node:assert/strict'
import {
  crossVector3,
  dotVector3,
  isZeroVector3,
  normalizeVector3,
  transformAffinePoint,
  transformHomogeneousPoint,
} from './vector.ts'

const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol

test('dotVector3: dot product of the first three components only', () => {
  assert.equal(dotVector3([1, 2, 3], [4, 5, 6]), 32)
  assert.equal(dotVector3([1, 0, 0], [0, 1, 0]), 0)
})

test('isZeroVector3: three zeros at the offset asked, a −0 is zero, a NaN or any other number is not', () => {
  assert.ok(isZeroVector3([0, 0, 0]))
  assert.ok(isZeroVector3([1, -0, 0, 0, 2], 1))
  assert.ok(!isZeroVector3([0, 0, 1e-300]))
  assert.ok(!isZeroVector3([0, NaN, 0]))
  assert.ok(!isZeroVector3([0, 0, 0, 5], 1))
})

test('crossVector3: x × y = z, right-hand rule', () => {
  const out = crossVector3(new Float64Array(3), [1, 0, 0], [0, 1, 0])
  assert.deepEqual([...out], [0, 0, 1])
})

test('crossVector3: generic vectors, the three components crossed', () => {
  const out = crossVector3(new Float64Array(3), [1, 2, 3], [4, 5, 6])
  assert.deepEqual([...out], [-3, 6, -3])
})

test('crossVector3: the output may alias either input, six reads before write', () => {
  const a: [number, number, number] = [1, 2, 3],
    b: [number, number, number] = [4, 5, 6]
  const expected = crossVector3(new Float64Array(3), a, b)
  const onA = Float64Array.from(a)
  crossVector3(onA, onA, b)
  assert.deepEqual([...onA], [...expected], 'out === a')
  const onB = Float64Array.from(b)
  crossVector3(onB, a, onB)
  assert.deepEqual([...onB], [...expected], 'out === b')
})

test('transformAffinePoint: identity leaves the point unchanged, translation alone shifts', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]
  const out = transformAffinePoint(new Float64Array(3), identity, 1, 2, 3)
  assert.deepEqual([...out], [6, 8, 10])
})

test('transformAffinePoint: no perspective divide even on a non-affine matrix', () => {
  // Last row (2, 0, 0, 1) instead of (0, 0, 0, 1): the function ignores this row by
  // construction, so its result depends only on the first three rows.
  const m = [1, 0, 0, 2, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const out = transformAffinePoint(new Float64Array(3), m, 3, 4, 5)
  assert.deepEqual([...out], [3, 4, 5])
})

test('transformHomogeneousPoint: carries the fourth component, divide left to the caller', () => {
  // A simple perspective projection matrix: w = -z.
  const proj = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0]
  const out = transformHomogeneousPoint(new Float64Array(4), proj, 2, 4, -10)
  assert.deepEqual([...out], [2, 4, -10, 10])
})

test('normalizeVector3: a zero vector stays zero, an ordinary vector becomes length 1', () => {
  const zero = new Float64Array([0, 0, 0])
  normalizeVector3(zero)
  assert.deepEqual([...zero], [0, 0, 0])
  const v = new Float64Array([3, 0, 4])
  normalizeVector3(v)
  assert.ok(close(Math.hypot(v[0], v[1], v[2]), 1))
  assert.ok(close(v[0], 0.6) && v[1] === 0 && close(v[2], 0.8))
})
