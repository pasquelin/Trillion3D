import test from 'node:test'
import assert from 'node:assert/strict'
import { solveTwoBoneIK } from './ik.ts'
import { Object3D } from '../object/object3d.ts'
import { Vector3 } from '../math/vector3.ts'
import { Quaternion } from '../math/quaternion.ts'
import { ikChain } from './ikChain.fixture.ts'

test('opposite IK poles choose mirrored elbows for the same reachable endpoint', () => {
  for (const sign of [-1, 1]) {
    const { root, mid, end } = ikChain()
    mid.position.set(0, 1, 0)
    end.position.set(0, 1, 0)
    solveTwoBoneIK(root, mid, end, new Vector3(1, 1, 0), new Vector3(0, 0, sign))
    const elbow = mid.getWorldPosition(new Vector3())
    assert.ok(elbow.distanceTo(new Vector3(0.5, 0.5, sign * Math.SQRT1_2)) < 1e-8)
    // Solve again from the bent pose: the previous bend must be removed before the new one.
    solveTwoBoneIK(root, mid, end, new Vector3(-1, 0, 1))
    assert.ok(end.getWorldPosition(new Vector3()).distanceTo(new Vector3(-1, 0, 1)) < 1e-8)
  }
})

test('an oblique pole settles a bent chain at its target without changing bone lengths', () => {
  const { root, mid, end } = ikChain(3, 2)
  root.position.set(4, -3, 2)
  end.position.set(2, 0, 0)
  const target = new Vector3(5, -1, 3)
  solveTwoBoneIK(root, mid, end, target, new Vector3(5, -5, 7))
  assert.ok(end.getWorldPosition().distanceTo(target) < 1e-7)
  assert.ok(Math.abs(mid.getWorldPosition().distanceTo(root.position) - 3) < 1e-7)
  assert.ok(Math.abs(mid.getWorldPosition().distanceTo(end.getWorldPosition()) - 2) < 1e-7)
})

test('unfolding with a pole preserves the physical orientation of attachments on the root', () => {
  for (const [direction, poleOffset] of [
    [new Vector3(0, 1, 0), new Vector3(1, 0, 1)],
    [new Vector3(1, 0, 0), new Vector3(0, 1, 1)],
  ]) {
    const { root, mid, end } = ikChain()
    root.position.set(4, 3, 2)
    mid.position.copy(direction)
    end.position.copy(direction).multiplyScalar(-1)
    const axis = direction.clone().cross(poleOffset).normalize()
    const rotation = new Quaternion().setFromAxisAngle(axis, Math.PI / 3)
    solveTwoBoneIK(
      root,
      mid,
      end,
      root.position.clone().add(direction),
      root.position.clone().add(poleOffset),
    )
    for (const basis of [new Vector3(1, 0, 0), new Vector3(0, 1, 0)]) {
      const expected = basis.clone().applyQuaternion(rotation)
      const actual = basis.clone().applyQuaternion(root.quaternion)
      assert.ok(actual.distanceTo(expected) < 1e-7)
    }
  }
})

test('final pole alignment publishes the solved joint matrices before any lazy position read', () => {
  const { root, mid, end } = ikChain(3, 2)
  solveTwoBoneIK(root, mid, end, new Vector3(1, 2, 1), new Vector3(0, 0, 5))
  const cachedMid = new Vector3().setFromMatrixPosition(mid.matrixWorld)
  const cachedEnd = new Vector3().setFromMatrixPosition(end.matrixWorld)
  assert.ok(cachedMid.distanceTo(mid.getWorldPosition()) < 1e-9)
  assert.ok(cachedEnd.distanceTo(end.getWorldPosition()) < 1e-9)
})

test('a zero-length second bone does not spuriously twist attachments about its unchanged axis', () => {
  const { root, mid, end } = ikChain(1, 0)
  mid.position.set(1, 1, -2)
  solveTwoBoneIK(root, mid, end, mid.position.clone(), new Vector3(1, -1, 0))
  assert.ok(
    new Vector3(1, 0, 0).applyQuaternion(root.quaternion).distanceTo(new Vector3(1, 0, 0)) < 1e-9,
  )
  assert.ok(end.getWorldPosition().distanceTo(mid.position) < 1e-9)
})

test('negligible preexisting bends do not introduce a sudden attachment roll at a pole', () => {
  for (const [first, second] of [
    [1, 1],
    [3, 2],
  ]) {
    const axes = [0, second * 1e-9].map((bend) => {
      const { root, mid, end } = ikChain(first, second)
      end.position.x = bend
      solveTwoBoneIK(root, mid, end, new Vector3(0, 1, 0), new Vector3(0, 0, 5))
      return new Vector3(1, 0, 0).applyQuaternion(root.quaternion)
    })
    assert.ok(axes[0].distanceTo(axes[1]) < 1e-7)
  }
})

test('an already-bent chain rolls onto a new pole plane before reaching its target', () => {
  for (const offset of [
    [1, 2, 1],
    [1, 1, 0],
    [0, 2, 2],
  ])
    for (const shift of [new Vector3(), new Vector3(4, -3, 2)]) {
      const root = new Object3D(),
        mid = new Object3D(),
        end = new Object3D()
      root.position.copy(shift)
      root.add(mid)
      mid.add(end)
      mid.position.set(0, 3, 0)
      end.position.set(2, 0, 0)
      const target = shift.clone().add(new Vector3(offset[0], offset[1], offset[2]))
      solveTwoBoneIK(root, mid, end, target, shift.clone().add(new Vector3(0, 0, 5)))
      assert.ok(end.getWorldPosition().distanceTo(target) < 1e-6)
      assert.ok(Math.abs(mid.getWorldPosition().distanceTo(shift) - 3) < 1e-9)
      assert.ok(Math.abs(mid.getWorldPosition().distanceTo(end.getWorldPosition()) - 2) < 1e-9)
    }
})

test('moving a pole across a posed chain mirrors the elbow while keeping the endpoint fixed', () => {
  const { root, mid, end } = ikChain()
  mid.position.set(0, 1, 0)
  end.position.set(1, 0, 0)
  const target = new Vector3(1, 1, 0)
  solveTwoBoneIK(root, mid, end, target, new Vector3(0, 0, 1))
  const positive = mid.getWorldPosition()
  solveTwoBoneIK(root, mid, end, target, new Vector3(0, 0, -1))
  const negative = mid.getWorldPosition()
  assert.ok(positive.distanceTo(new Vector3(0.5, 0.5, Math.SQRT1_2)) < 1e-7)
  assert.ok(negative.distanceTo(new Vector3(0.5, 0.5, -Math.SQRT1_2)) < 1e-7)
  assert.ok(end.getWorldPosition().distanceTo(target) < 1e-7)
})

test('zero-weight IK preserves nonidentity root and middle rotations even with a new pole', () => {
  const { root, mid, end } = ikChain()
  mid.position.set(0, 3, 0)
  end.position.set(2, 0, 0)
  root.rotation.set(0.3, -0.5, 0.8)
  mid.rotation.set(-0.2, 0.4, 0.1)
  const keptRoot = root.quaternion.toArray(),
    keptMid = mid.quaternion.toArray()
  solveTwoBoneIK(root, mid, end, new Vector3(1, 2, 1), new Vector3(0, 0, 5), 0)
  assert.deepEqual(root.quaternion.toArray(), keptRoot)
  assert.deepEqual(mid.quaternion.toArray(), keptMid)
})

test('pole places the elbow in the target plane on the first solve and repeated solves stay still', () => {
  for (const shift of [new Vector3(), new Vector3(4, -2, 7)]) {
    const { root, mid, end } = ikChain(3, 2)
    root.position.copy(shift)
    const targetOffset = new Vector3(1, 2, 1)
    const poleOffset = new Vector3(0, 0, 5)
    const target = targetOffset.clone().add(shift)
    const pole = poleOffset.clone().add(shift)
    // Intersect the radius-3 sphere around root with the radius-2 sphere around target.
    const along = (9 - 4 + targetOffset.lengthSq()) / (2 * targetOffset.lengthSq())
    const centre = targetOffset.clone().multiplyScalar(along)
    const radius = Math.sqrt(9 - centre.lengthSq())
    const across = poleOffset
      .clone()
      .addScaledVector(targetOffset, -poleOffset.dot(targetOffset) / targetOffset.lengthSq())
      .normalize()
    const expected = centre.addScaledVector(across, radius).add(shift)
    for (let repeat = 0; repeat < 3; repeat++) {
      solveTwoBoneIK(root, mid, end, target, pole)
      assert.ok(mid.getWorldPosition(new Vector3()).distanceTo(expected) < 1e-7)
      const elbow = mid.getWorldPosition(new Vector3())
      const tip = end.getWorldPosition(new Vector3())
      assert.ok(tip.distanceTo(target) < 1e-7)
      assert.ok(Math.abs(elbow.distanceTo(shift) - 3) < 1e-7)
      assert.ok(Math.abs(tip.distanceTo(elbow) - 2) < 1e-7)
    }
  }
})

test('near-collinear IK targets and poles retain a stable bend under uniform scene scaling', () => {
  for (const poleCase of [false, true]) {
    const elbows: Vector3[] = []
    for (const scale of [0.1, 1, 10]) {
      const { root, mid, end } = ikChain()
      mid.position.set(0, 3 * scale, 0)
      end.position.set(0, 2 * scale, 0)
      const target = (poleCase ? new Vector3(2, 1, 0) : new Vector3(0, 2, 1e-9)).multiplyScalar(
        scale,
      )
      const pole = poleCase ? new Vector3(0, 5, 1e-9).multiplyScalar(scale) : undefined
      solveTwoBoneIK(root, mid, end, target, pole)
      elbows.push(mid.getWorldPosition().multiplyScalar(1 / scale))
      assert.ok(end.getWorldPosition().distanceTo(target) < scale * 1e-6)
    }
    assert.ok(elbows[0].distanceTo(elbows[1]) < 1e-6)
    assert.ok(elbows[2].distanceTo(elbows[1]) < 1e-6)
    assert.ok(Math.abs(elbows[1].z) < 1e-6)
  }
})
