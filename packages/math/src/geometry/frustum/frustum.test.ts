import assert from 'node:assert/strict'
import test from 'node:test'
import { frustumContainsPoint, frustumExcludesSphere, frustumPlanesFromMatrix } from './frustum.ts'
import { HALTON_SWEEP, haltonSpan } from '../../sequence/sweep.fixture.ts'

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

test('the plane distance is signed and read at each plane: 1 − x to the face x = 1', () => {
  // Slot 0 of the cube is x = 1 facing −x; slot 20, z = −1 facing +z, is 1 + z away.
  assert.equal(frustumExcludesSphere(CUBE, 2.75, 0.5, -0.5, 1.75), false, 'at 1.75, touching')
  assert.equal(frustumExcludesSphere(CUBE, 2.75, 0, 0, 1.5), true, 'past it by 0.25')
  assert.equal(frustumExcludesSphere(CUBE, 0, 0, -3, 2), false, 'at 2 behind z = −1, touching')
  assert.equal(frustumExcludesSphere(CUBE, 0, 0, -3, 1.75), true)
})

test('frustumExcludesSphere: past a face by more than its radius, and the light-reach loop', () => {
  assert.equal(frustumExcludesSphere(CUBE, 3, 0, 0, 1.5), true)
  assert.equal(frustumExcludesSphere(CUBE, 3, 0, 0, 2), false, 'touching the face')
  assert.equal(frustumExcludesSphere(CUBE, 0, 0, 0, 0), false)
  assert.equal(frustumExcludesSphere(CUBE, NaN, 0, 0, 1), false, 'a NaN keeps the sphere')
  const old = (x: number, y: number, z: number, reach: number) => {
    for (let p = 0; p < 24; p += 4)
      if (CUBE[p] * x + CUBE[p + 1] * y + CUBE[p + 2] * z + CUBE[p + 3] < -reach) return true
    return false
  }
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const x = haltonSpan(i, 2, -4, 4),
      y = haltonSpan(i, 3, -4, 4),
      z = haltonSpan(i, 5, -4, 4),
      reach = haltonSpan(i, 7, 0, 2)
    assert.equal(frustumExcludesSphere(CUBE, x, y, z, reach), old(x, y, z, reach), `${i}`)
    assert.equal(
      frustumContainsPoint(CUBE, x, y, z),
      !frustumExcludesSphere(CUBE, x, y, z, 0) &&
        Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= 1,
      `${i}`,
    )
  }
})
