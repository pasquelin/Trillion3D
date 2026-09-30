import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoBoneIK } from './ik.ts';
import { ikChain } from './ikChain.fixture.ts';
import { Object3D } from '../object/object3d.ts';
import { Vector3 } from '../math/vector3.ts';

test('IK settles cached descendant matrices before returning without lazy world-position reads', () => {
  for (const weight of [0.5, 1]) {
    const { root, mid, end } = ikChain();
    root.updateMatrixWorld(true);
    solveTwoBoneIK(root, mid, end, new Vector3(1, 1, 0), undefined, weight);
    const settled = Array.from(end.matrixWorld.elements.slice(12, 15));
    if (weight === 1)
      assert.ok(
        new Vector3(...(settled as [number, number, number])).distanceTo(new Vector3(1, 1, 0)) <
          1e-8,
      );
    root.updateMatrixWorld(true);
    assert.deepEqual(Array.from(end.matrixWorld.elements.slice(12, 15)), settled);
  }
});

test('IK normalizes writable identity quaternions while preserving rigid bone lengths', () => {
  const { root, mid, end } = ikChain();
  // These quaternions both compose to the identity matrix before the solver turns them.
  root.quaternion.set(0, 0, 0, 2);
  mid.quaternion.set(0, 0, 0, 3);
  solveTwoBoneIK(root, mid, end, new Vector3(1, 1, 0));
  assert.ok(end.getWorldPosition().distanceTo(new Vector3(1, 1, 0)) < 1e-8);
  assert.ok(Math.abs(root.quaternion.length() - 1) < 1e-12);
  assert.ok(Math.abs(mid.quaternion.length() - 1) < 1e-12);
});

test('IK refreshes manually driven descendants even when an already reached pose needs no turn', () => {
  const root = new Object3D(),
    mid = new Object3D(),
    end = new Object3D(),
    marker = new Object3D();
  root.add(mid, marker);
  mid.add(end);
  for (const node of [root, mid, end, marker]) node.matrixAutoUpdate = false;
  mid.matrix.makeTranslation(1, 0, 0);
  end.matrix.makeTranslation(-0.5, Math.sqrt(3) / 2, 0);
  root.updateMatrixWorld(true);
  marker.matrix.makeTranslation(4, 5, 6);
  solveTwoBoneIK(root, mid, end, new Vector3(0.5, Math.sqrt(3) / 2, 0));
  assert.deepEqual(Array.from(marker.matrixWorld.elements.slice(12, 15)), [4, 5, 6]);
});
