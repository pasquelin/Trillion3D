import test from 'node:test'
import assert from 'node:assert/strict'
import { solveTwoBoneIK } from './ik.ts'
import { Object3D } from '../object/object3d.ts'
import { Vector3 } from '../math/vector3.ts'
import { Quaternion } from '../math/quaternion.ts'
import { ikChain } from './ikChain.fixture.ts'

function parentedChain() {
  const parent = new Object3D(),
    root = new Object3D(),
    mid = new Object3D(),
    end = new Object3D()
  parent.position.set(4, -2, 3)
  parent.rotation.set(0.3, -0.5, 0.8)
  parent.add(root)
  root.add(mid)
  mid.add(end)
  mid.position.set(0, 3, 0)
  end.position.set(0, 2, 0)
  parent.updateMatrixWorld(true)
  return { parent, root, mid, end }
}

test('two-bone IK reaches arbitrary world targets while keeping both lengths and root position', () => {
  for (const offset of [
    [2, 1, 2],
    [-2, 3, -1],
    [0, -3, 0],
    [3, 0, 0],
  ]) {
    const { root, mid, end } = parentedChain()
    const start = root.getWorldPosition(new Vector3())
    const target = start.clone().add(new Vector3(offset[0], offset[1], offset[2]))
    const pole = start.clone().add(new Vector3(2, 3, 4))
    solveTwoBoneIK(root, mid, end, target, pole)
    const a = root.getWorldPosition(new Vector3()),
      b = mid.getWorldPosition(new Vector3()),
      c = end.getWorldPosition(new Vector3())
    assert.ok(a.distanceTo(start) < 1e-9)
    assert.ok(Math.abs(a.distanceTo(b) - 3) < 1e-9)
    assert.ok(Math.abs(b.distanceTo(c) - 2) < 1e-9)
    assert.ok(c.distanceTo(target) < 1e-6, `${c.toArray()} target ${target.toArray()}`)
    assert.ok(Math.abs(root.quaternion.length() - 1) < 1e-9)
    assert.ok(Math.abs(mid.quaternion.length() - 1) < 1e-9)
  }
})

test('IK weights preserve zero poses, blend partial rotations and clamp overshoot', () => {
  for (const weight of [-1, 0, 0.25, 0.5, 1, 2]) {
    const a = parentedChain(),
      full = parentedChain(),
      target = new Vector3(6, 0, 4)
    solveTwoBoneIK(full.root, full.mid, full.end, target)
    const expectedRoot = a.root.quaternion
      .clone()
      .slerp(full.root.quaternion, Math.min(1, Math.max(0, weight)))
    const expectedMid = a.mid.quaternion
      .clone()
      .slerp(full.mid.quaternion, Math.min(1, Math.max(0, weight)))
    solveTwoBoneIK(a.root, a.mid, a.end, target, undefined, weight)
    assert.ok(a.root.quaternion.angleTo(expectedRoot) < 1e-6)
    assert.ok(a.mid.quaternion.angleTo(expectedMid) < 1e-6)
  }
})

test('bent chains without poles preserve their lengths while reaching targets outside their old plane', () => {
  for (const target of [new Vector3(1, 2, 1), new Vector3(-2, 1, 2), new Vector3(1, 1, -2)]) {
    const { root, mid, end } = ikChain(3, 2)
    end.position.set(2, 0, 0)
    solveTwoBoneIK(root, mid, end, target)
    assert.ok(end.getWorldPosition().distanceTo(target) < 1e-7)
    assert.ok(Math.abs(mid.getWorldPosition().length() - 3) < 1e-7)
  }
})

test('a solve needing no final swing still publishes rotated sibling world matrices', () => {
  const { root, mid, end } = ikChain()
  const marker = end.clone()
  marker.position.set(2, 0, 0)
  root.add(marker)
  root.updateMatrixWorld(true)
  solveTwoBoneIK(root, mid, end, new Vector3(0, 1, 0))
  const cached = new Vector3().setFromMatrixPosition(marker.matrixWorld)
  const expected = marker.position.clone().applyMatrix4(root.matrixWorld)
  assert.ok(cached.distanceTo(expected) < 1e-9)
})

test('without a pole the original bend plane follows the shortest swing onto the target', () => {
  const { root, mid, end } = ikChain(3, 2)
  end.position.set(2, 0, 0)
  const axis = end.getWorldPosition().normalize()
  const side = mid.position.clone().addScaledVector(axis, -mid.position.dot(axis)).normalize()
  const target = new Vector3(1, 2, 1),
    distance = target.length()
  const along = (9 + distance * distance - 4) / (2 * distance)
  const expected = axis
    .clone()
    .multiplyScalar(along)
    .addScaledVector(side, Math.sqrt(9 - along * along))
    .applyQuaternion(new Quaternion().setFromUnitVectors(axis, target.clone().normalize()))
  solveTwoBoneIK(root, mid, end, target)
  assert.ok(mid.getWorldPosition().distanceTo(expected) < 1e-7)
})

test('IK settles cached descendant matrices before returning without lazy world-position reads', () => {
  for (const weight of [0.5, 1]) {
    const { root, mid, end } = ikChain()
    root.updateMatrixWorld(true)
    solveTwoBoneIK(root, mid, end, new Vector3(1, 1, 0), undefined, weight)
    const settled = Array.from(end.matrixWorld.elements.slice(12, 15))
    if (weight === 1)
      assert.ok(
        new Vector3(...(settled as [number, number, number])).distanceTo(new Vector3(1, 1, 0)) <
          1e-8,
      )
    root.updateMatrixWorld(true)
    assert.deepEqual(Array.from(end.matrixWorld.elements.slice(12, 15)), settled)
  }
})

test('IK normalizes writable identity quaternions while preserving rigid bone lengths', () => {
  const { root, mid, end } = ikChain()
  // These quaternions both compose to the identity matrix before the solver turns them.
  root.quaternion.set(0, 0, 0, 2)
  mid.quaternion.set(0, 0, 0, 3)
  solveTwoBoneIK(root, mid, end, new Vector3(1, 1, 0))
  assert.ok(end.getWorldPosition().distanceTo(new Vector3(1, 1, 0)) < 1e-8)
  assert.ok(Math.abs(root.quaternion.length() - 1) < 1e-12)
  assert.ok(Math.abs(mid.quaternion.length() - 1) < 1e-12)
})

test('IK refreshes manually driven descendants even when an already reached pose needs no turn', () => {
  const root = new Object3D(),
    mid = new Object3D(),
    end = new Object3D(),
    marker = new Object3D()
  root.add(mid, marker)
  mid.add(end)
  for (const node of [root, mid, end, marker]) node.matrixAutoUpdate = false
  mid.matrix.makeTranslation(1, 0, 0)
  end.matrix.makeTranslation(-0.5, Math.sqrt(3) / 2, 0)
  root.updateMatrixWorld(true)
  marker.matrix.makeTranslation(4, 5, 6)
  solveTwoBoneIK(root, mid, end, new Vector3(0.5, Math.sqrt(3) / 2, 0))
  assert.deepEqual(Array.from(marker.matrixWorld.elements.slice(12, 15)), [4, 5, 6])
})
