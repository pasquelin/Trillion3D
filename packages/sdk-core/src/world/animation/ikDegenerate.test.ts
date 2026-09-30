import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoBoneIK } from './ik.ts';
import { ikChain } from './ikChain.fixture.ts';
import { Object3D } from '../object/object3d.ts';
import { Vector3 } from '../math/vector3.ts';

test('collinear IK targets reach behind the chain and work independently of bone scale', () => {
  for (const length of [0.1, 1, 10])
    for (const axis of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ])
      for (const direction of [-1, 1]) {
        const root = new Object3D(),
          mid = new Object3D(),
          end = new Object3D();
        root.add(mid);
        mid.add(end);
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
