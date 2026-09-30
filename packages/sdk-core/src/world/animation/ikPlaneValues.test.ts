import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoBoneIK } from './ik.ts';
import { ikChain } from './ikChain.fixture.ts';
import { Vector3 } from '../math/vector3.ts';
import { Quaternion } from '../math/quaternion.ts';

test('bent chains without poles preserve their lengths while reaching targets outside their old plane', () => {
  for (const target of [new Vector3(1, 2, 1), new Vector3(-2, 1, 2), new Vector3(1, 1, -2)]) {
    const { root, mid, end } = ikChain(3, 2);
    end.position.set(2, 0, 0);
    solveTwoBoneIK(root, mid, end, target);
    assert.ok(end.getWorldPosition().distanceTo(target) < 1e-7);
    assert.ok(Math.abs(mid.getWorldPosition().length() - 3) < 1e-7);
  }
});

test('a straight or negligibly bent chain without a pole bends in the root-end-target plane', () => {
  for (const [first, second, bend] of [
    [1, 1, 0],
    [1, 1, 1e-9],
    [3, 2, 2e-9],
  ]) {
    const { root, mid, end } = ikChain(first, second);
    end.position.x = bend;
    const originalAxis = end.getWorldPosition();
    const target = new Vector3(1, 1, 1);
    const normal = originalAxis.clone().cross(target).normalize();
    solveTwoBoneIK(root, mid, end, target);
    assert.ok(end.getWorldPosition().distanceTo(target) < 1e-7);
    assert.ok(Math.abs(mid.getWorldPosition().dot(normal)) < 1e-7);
  }
});

test('an oblique pole settles a bent chain at its target without changing bone lengths', () => {
  const { root, mid, end } = ikChain(3, 2);
  root.position.set(4, -3, 2);
  end.position.set(2, 0, 0);
  const target = new Vector3(5, -1, 3);
  solveTwoBoneIK(root, mid, end, target, new Vector3(5, -5, 7));
  assert.ok(end.getWorldPosition().distanceTo(target) < 1e-7);
  assert.ok(Math.abs(mid.getWorldPosition().distanceTo(root.position) - 3) < 1e-7);
  assert.ok(Math.abs(mid.getWorldPosition().distanceTo(end.getWorldPosition()) - 2) < 1e-7);
});

test('sub-threshold target movement does not suddenly flip a straight chain elbow', () => {
  const elbows = [0, 5e-10].map((z) => {
    const { root, mid, end } = ikChain();
    solveTwoBoneIK(root, mid, end, new Vector3(0, 1, z));
    return mid.getWorldPosition();
  });
  assert.ok(elbows[0].distanceTo(elbows[1]) < 1e-7);
});

test('a solve needing no final swing still publishes rotated sibling world matrices', () => {
  const { root, mid, end } = ikChain();
  const marker = end.clone();
  marker.position.set(2, 0, 0);
  root.add(marker);
  root.updateMatrixWorld(true);
  solveTwoBoneIK(root, mid, end, new Vector3(0, 1, 0));
  const cached = new Vector3().setFromMatrixPosition(marker.matrixWorld);
  const expected = marker.position.clone().applyMatrix4(root.matrixWorld);
  assert.ok(cached.distanceTo(expected) < 1e-9);
});

test('aiming exactly at the root keeps the limiting folded pose instead of adding a quarter-turn', () => {
  const elbows = [0, 1e-6].map((y) => {
    const { root, mid, end } = ikChain();
    solveTwoBoneIK(root, mid, end, new Vector3(0, y, 0));
    return mid.getWorldPosition();
  });
  assert.ok(elbows[0].distanceTo(elbows[1]) < 1e-7);
});

test('a straight chain nearly parallel to X folds toward the transverse Y axis', () => {
  const { root, mid, end } = ikChain();
  const direction = new Vector3(0.9, 0, Math.sqrt(0.19));
  mid.position.copy(direction);
  end.position.copy(direction);
  solveTwoBoneIK(root, mid, end, direction);
  const elbow = mid.getWorldPosition();
  assert.ok(Math.abs(elbow.x - 0.45) < 1e-8);
  assert.ok(Math.abs(elbow.y - Math.sqrt(0.75)) < 1e-8);
  assert.ok(Math.abs(elbow.z - Math.sqrt(0.19) / 2) < 1e-8);
});

test('a bent chain half-turn keeps both bones on the same turn in its transverse plane', () => {
  const { root, mid, end } = ikChain();
  mid.position.set(4.5, 1, Math.sqrt(19) / 2);
  end.position.set(4.5, -1, Math.sqrt(19) / 2);
  const expectedElbow = mid.position.clone().multiplyScalar(-1);
  const target = new Vector3(-9, 0, -Math.sqrt(19));
  solveTwoBoneIK(root, mid, end, target);
  assert.ok(mid.getWorldPosition().distanceTo(expectedElbow) < 1e-7);
  assert.ok(end.getWorldPosition().distanceTo(target) < 1e-7);
});

test('without a pole the original bend plane follows the shortest swing onto the target', () => {
  const { root, mid, end } = ikChain(3, 2);
  end.position.set(2, 0, 0);
  const axis = end.getWorldPosition().normalize();
  const side = mid.position.clone().addScaledVector(axis, -mid.position.dot(axis)).normalize();
  const target = new Vector3(1, 2, 1),
    distance = target.length();
  const along = (9 + distance * distance - 4) / (2 * distance);
  const expected = axis
    .clone()
    .multiplyScalar(along)
    .addScaledVector(side, Math.sqrt(9 - along * along))
    .applyQuaternion(new Quaternion().setFromUnitVectors(axis, target.clone().normalize()));
  solveTwoBoneIK(root, mid, end, target);
  assert.ok(mid.getWorldPosition().distanceTo(expected) < 1e-7);
});

test('unfolding with a pole preserves the physical orientation of attachments on the root', () => {
  for (const [direction, poleOffset] of [
    [new Vector3(0, 1, 0), new Vector3(1, 0, 1)],
    [new Vector3(1, 0, 0), new Vector3(0, 1, 1)],
  ]) {
    const { root, mid, end } = ikChain();
    root.position.set(4, 3, 2);
    mid.position.copy(direction);
    end.position.copy(direction).multiplyScalar(-1);
    const axis = direction.clone().cross(poleOffset).normalize();
    const rotation = new Quaternion().setFromAxisAngle(axis, Math.PI / 3);
    solveTwoBoneIK(
      root,
      mid,
      end,
      root.position.clone().add(direction),
      root.position.clone().add(poleOffset),
    );
    for (const basis of [new Vector3(1, 0, 0), new Vector3(0, 1, 0)]) {
      const expected = basis.clone().applyQuaternion(rotation);
      const actual = basis.clone().applyQuaternion(root.quaternion);
      assert.ok(actual.distanceTo(expected) < 1e-7);
    }
  }
});
