import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoBoneIK } from './ik.ts';
import { Object3D } from '../object/object3d.ts';
import { Vector3 } from '../math/vector3.ts';
import { ikChain } from './ikChain.fixture.ts';

test('straight chains use a fallback bending plane and unreachable targets stop at full reach', () => {
  for (const axis of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]) {
    const { root, mid, end } = ikChain();
    mid.position.set(...(axis as [number, number, number]));
    end.position.copy(mid.position);
    root.updateMatrixWorld(true);
    const target = new Vector3(axis[0], axis[1], axis[2]).multiplyScalar(7);
    solveTwoBoneIK(root, mid, end, target, target);
    const reached = end.getWorldPosition(new Vector3());
    assert.ok(reached.distanceTo(new Vector3(axis[0], axis[1], axis[2]).multiplyScalar(2)) < 1e-5);
    assert.ok(reached.distanceTo(target) > 4.99);
    solveTwoBoneIK(root, mid, end, new Vector3(0.5, 0.5, 0.5));
    assert.ok(end.getWorldPosition(new Vector3()).distanceTo(new Vector3(0.5, 0.5, 0.5)) < 1e-5);
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

test('aiming exactly at the root keeps the limiting folded pose instead of adding a quarter-turn', () => {
  const elbows = [0, 1e-6].map((y) => {
    const { root, mid, end } = ikChain();
    solveTwoBoneIK(root, mid, end, new Vector3(0, y, 0));
    return mid.getWorldPosition();
  });
  assert.ok(elbows[0].distanceTo(elbows[1]) < 1e-7);
});

test('a bent chain half-turn keeps both bones on the same turn in its transverse plane', () => {
  const z = Math.sqrt(19) / 2;
  for (const [elbow, tip] of [
    [new Vector3(4.5, 1, z), new Vector3(4.5, -1, z)],
    [new Vector3(1, 2, 0.5), new Vector3(1, -2, 0.3)],
  ]) {
    const { root, mid, end } = ikChain();
    mid.position.copy(elbow);
    end.position.copy(tip);
    const expectedElbow = elbow.clone().multiplyScalar(-1);
    const target = end.getWorldPosition().multiplyScalar(-1);
    solveTwoBoneIK(root, mid, end, target);
    assert.ok(mid.getWorldPosition().distanceTo(expectedElbow) < 1e-7);
    assert.ok(end.getWorldPosition().distanceTo(target) < 1e-7);
  }
});

test('collinear IK targets reach behind the chain and work independently of bone scale', () => {
  for (const length of [0.1, 1, 10])
    for (const axis of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ])
      for (const direction of [-1, 1]) {
        const { root, mid, end } = ikChain();
        mid.position.set(axis[0] * length, axis[1] * length, axis[2] * length);
        end.position.copy(mid.position);
        const target = mid.position.clone().multiplyScalar(direction);
        solveTwoBoneIK(root, mid, end, target);
        assert.ok(
          end.getWorldPosition().distanceTo(target) < length * 1e-8,
          `bone ${length}, axis ${axis}, direction ${direction}`,
        );
      }
});

test('fully folded IK chains open toward reachable targets instead of staying at their root', () => {
  for (const axis of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ])
    for (const offset of [
      [1, 0, 0],
      [0, 1, 1],
      [-0.5, 0.5, -0.5],
    ]) {
      const root = new Object3D(),
        mid = new Object3D(),
        end = new Object3D();
      root.position.set(3, 4, 5);
      root.add(mid);
      mid.add(end);
      mid.position.set(axis[0], axis[1], axis[2]);
      end.position.copy(mid.position).multiplyScalar(-1);
      const target = root.position.clone().add(new Vector3(offset[0], offset[1], offset[2]));
      solveTwoBoneIK(root, mid, end, target);
      assert.ok(end.getWorldPosition().distanceTo(target) < 1e-7, `${axis} toward ${offset}`);
    }
});

test('IK aimed at its root stays finite and folds to within its numerical reach limit', () => {
  const { root, mid, end } = ikChain();
  solveTwoBoneIK(root, mid, end, new Vector3());
  assert.ok(end.getWorldPosition().length() < 1e-5);
  for (const node of [root, mid, end])
    assert.ok([...node.matrixWorld.elements].every(Number.isFinite));
});

test('IK keeps an unreachable chain slightly bent so its next solve remains well-defined', () => {
  const { root, mid, end } = ikChain();
  mid.position.set(0, 3, 0);
  end.position.set(0, 2, 0);
  solveTwoBoneIK(root, mid, end, new Vector3(0, 9, 0));
  const a = mid.getWorldPosition(),
    b = end.getWorldPosition();
  assert.ok(b.length() < 5);
  assert.ok(b.length() > 4.99);
  assert.ok(Math.hypot(a.x, a.z) > 0);
  solveTwoBoneIK(root, mid, end, new Vector3(2, 1, 1));
  assert.ok(end.getWorldPosition().distanceTo(new Vector3(2, 1, 1)) < 1e-6);
});
