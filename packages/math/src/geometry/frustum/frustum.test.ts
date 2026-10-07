import assert from 'node:assert/strict'
import test from 'node:test'
import { frustumContainsPoint, frustumPlanesFromMatrix } from './frustum.ts'

/** The six inward planes of the cube |x|, |y|, |z| ≤ 1, each `a, b, c, d`. */
const CUBE = [-1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, -1, 0, 1, 0, 0, 1, 1, 0, 0, -1, 1]

test('frustumContainsPoint: the centre and a face inside, a point past a face outside', () => {
  assert.equal(frustumContainsPoint(CUBE, 0, 0, 0), true)
  assert.equal(frustumContainsPoint(CUBE, 1, 0, 0), true)
  assert.equal(frustumContainsPoint(CUBE, 1.5, 0, 0), false)
  assert.equal(frustumContainsPoint(CUBE, 0, 0, -1.01), false)
})

test('frustumPlanesFromMatrix: unit normals, a scaled clip matrix gives the same planes', () => {
  // Clip x = 3·x, y = 4·y, z = 12·z, w = 13: the x planes have normal ±3 and offset 13 before the
  // division by 3, the z plane at slot 16 has normal (0, 0, 12): one division each, exact here.
  const m = new Float64Array(16)
  m[0] = 3
  m[5] = 4
  m[10] = 12
  m[15] = 13
  const planes = new Float64Array(24)
  frustumPlanesFromMatrix(planes, m)
  assert.deepEqual([...planes.subarray(0, 4)], [-1, 0, 0, 13 / 3])
  assert.deepEqual([...planes.subarray(8, 12)], [0, 1, 0, 13 / 4])
  assert.deepEqual([...planes.subarray(16, 20)], [0, 0, 1, 0])
  assert.equal(frustumContainsPoint(planes, 13 / 3, 0, 0.5), true)
  assert.equal(frustumContainsPoint(planes, 0, 0, -0.1), false)
})
