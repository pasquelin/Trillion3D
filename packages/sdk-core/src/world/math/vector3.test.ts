import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3, readVec3 } from './vector3.ts'
import { Matrix3, Matrix4 } from './matrix4.ts'
import { Quaternion } from './quaternion.ts'
import { listen } from '../observed.ts'
import { near as within } from '../../../../math/src/float/near.fixture.ts'

const near = (actual: number[], expected: number[]) => within(actual, expected, 'vector', 1e-10)

test('vector arithmetic preserves every component and supports in-place operands', () => {
  const a = new Vector3(2, -3, 4),
    b = new Vector3(5, 7, -2)
  assert.deepEqual(a.clone().add(b).toArray(), [7, 4, 2])
  assert.deepEqual(a.clone().addScalar(3).toArray(), [5, 0, 7])
  assert.deepEqual(new Vector3().addVectors(a, b).toArray(), [7, 4, 2])
  assert.deepEqual(a.clone().addScaledVector(b, 2).toArray(), [12, 11, 0])
  assert.deepEqual(a.clone().sub(b).toArray(), [-3, -10, 6])
  assert.deepEqual(new Vector3().subVectors(a, b).toArray(), [-3, -10, 6])
  assert.deepEqual(a.clone().multiply(b).toArray(), [10, -21, -8])
  assert.deepEqual(a.clone().multiplyScalar(2).toArray(), [4, -6, 8])
  assert.deepEqual(a.clone().divideScalar(2).toArray(), [1, -1.5, 2])
  assert.deepEqual(a.clone().negate().toArray(), [-2, 3, -4])
  assert.deepEqual(a.clone().min(b).toArray(), [2, -3, -2])
  assert.deepEqual(a.clone().max(b).toArray(), [5, 7, 4])
  assert.equal(a.dot(b), -19)
  assert.deepEqual(a.clone().cross(b).toArray(), [-22, 24, 29])
  assert.deepEqual(new Vector3().crossVectors(a, b).toArray(), [-22, 24, 29])
  assert.equal(a.lengthSq(), 29)
  assert.equal(new Vector3(3, 4, 12).length(), 13)
  near(new Vector3(3, 4, 0).normalize().toArray(), [0.6, 0.8, 0])
  near(new Vector3(3, 4, 0).setLength(10).toArray(), [6, 8, 0])
  assert.deepEqual(new Vector3().normalize().toArray(), [0, 0, 0])
  assert.equal(a.distanceToSquared(b), 145)
  assert.equal(new Vector3(3, 4, 12).distanceTo(new Vector3()), 13)
  assert.deepEqual(a.clone().lerp(b, 0.5).toArray(), [3.5, 2, 1])
  assert.deepEqual(new Vector3().lerpVectors(a, b, 0.25).toArray(), [2.75, -0.5, 2.5])
  assert.ok(a.equals(a.clone()))
  for (const other of [
    [3, -3, 4],
    [2, -2, 4],
    [2, -3, 5],
  ])
    assert.equal(a.equals(new Vector3(...other)), false)
  assert.deepEqual(a.toArray(), [2, -3, 4])
})

test('vector writes notify owners only when values change and copies own their storage', () => {
  const value = new Vector3()
  let writes = 0
  listen(value, () => writes++)
  assert.equal(value.set(1, 2, 3), value)
  assert.equal(writes, 1)
  value.set(1, 2, 3)
  assert.equal(writes, 1)
  value.set(2, 2, 3)
  value.set(2, 3, 3)
  value.set(2, 3, 4)
  assert.equal(writes, 4)
  value.setScalar(5)
  assert.deepEqual(value.toArray(), [5, 5, 5])
  value.copy({ x: 7, y: 8, z: 9 })
  assert.deepEqual(value.toArray(), [7, 8, 9])
  const clone = value.clone()
  clone.x = 20
  assert.equal(value.x, 7)
  assert.notEqual(clone.elements, value.elements)
  value.fromArray([91, 3, 4, 5, 92], 1)
  assert.deepEqual(value.toArray(), [3, 4, 5])
  assert.deepEqual(readVec3(value), [3, 4, 5])
  assert.deepEqual(readVec3([6, 7, 8]), [6, 7, 8])
})

test('point, direction and rotation transforms have distinct physical meanings', () => {
  const affine = new Matrix4().makeScale(2, 3, 4).setPosition(10, 20, 30)
  assert.deepEqual(new Vector3(1, 2, 3).applyMatrix4(affine).toArray(), [12, 26, 42])
  near(new Vector3(1, 0, 0).transformDirection(affine).toArray(), [1, 0, 0])
  assert.deepEqual(new Vector3().setFromMatrixPosition(affine).toArray(), [10, 20, 30])
  const projective = new Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1)
  near(new Vector3(2, 4, 1).applyMatrix4(projective).toArray(), [1, 2, 0.5])
  const linear = new Matrix3().set(2, 0, 0, 0, 3, 0, 0, 0, 4)
  assert.deepEqual(new Vector3(1, 2, 3).applyMatrix3(linear).toArray(), [2, 6, 12])
  const turn = new Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2)
  near(new Vector3(1, 0, 0).applyQuaternion(turn).toArray(), [0, 1, 0])
  near(
    new Vector3().setFromSpherical({ radius: 2, phi: Math.PI / 2, theta: Math.PI / 2 }).toArray(),
    [2, 0, 0],
  )
})
