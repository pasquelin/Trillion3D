import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoBoneIK } from './ik.ts';
import { Object3D } from '../object/object3d.ts';
import { Vector3 } from '../math/vector3.ts';

test('an already-bent chain rolls onto a new pole plane before reaching its target', () => {
  for (const offset of [
    [1, 2, 1],
    [1, 1, 0],
    [0, 2, 2],
  ])
    for (const shift of [new Vector3(), new Vector3(4, -3, 2)]) {
      const root = new Object3D(),
        mid = new Object3D(),
        end = new Object3D();
      root.position.copy(shift);
      root.add(mid);
      mid.add(end);
      mid.position.set(0, 3, 0);
      end.position.set(2, 0, 0);
      const target = shift.clone().add(new Vector3(offset[0], offset[1], offset[2]));
      solveTwoBoneIK(root, mid, end, target, shift.clone().add(new Vector3(0, 0, 5)));
      assert.ok(end.getWorldPosition().distanceTo(target) < 1e-6);
      assert.ok(Math.abs(mid.getWorldPosition().distanceTo(shift) - 3) < 1e-9);
      assert.ok(Math.abs(mid.getWorldPosition().distanceTo(end.getWorldPosition()) - 2) < 1e-9);
    }
});

test('moving a pole across a posed chain mirrors the elbow while keeping the endpoint fixed', () => {
  const root = new Object3D(),
    mid = new Object3D(),
    end = new Object3D();
  root.add(mid);
  mid.add(end);
  mid.position.set(0, 1, 0);
  end.position.set(1, 0, 0);
  const target = new Vector3(1, 1, 0);
  solveTwoBoneIK(root, mid, end, target, new Vector3(0, 0, 1));
  const positive = mid.getWorldPosition();
  solveTwoBoneIK(root, mid, end, target, new Vector3(0, 0, -1));
  const negative = mid.getWorldPosition();
  assert.ok(positive.distanceTo(new Vector3(0.5, 0.5, Math.SQRT1_2)) < 1e-7);
  assert.ok(negative.distanceTo(new Vector3(0.5, 0.5, -Math.SQRT1_2)) < 1e-7);
  assert.ok(end.getWorldPosition().distanceTo(target) < 1e-7);
});

test('zero-weight IK preserves nonidentity root and middle rotations even with a new pole', () => {
  const root = new Object3D(),
    mid = new Object3D(),
    end = new Object3D();
  root.add(mid);
  mid.add(end);
  mid.position.set(0, 3, 0);
  end.position.set(2, 0, 0);
  root.rotation.set(0.3, -0.5, 0.8);
  mid.rotation.set(-0.2, 0.4, 0.1);
  const keptRoot = root.quaternion.toArray(),
    keptMid = mid.quaternion.toArray();
  solveTwoBoneIK(root, mid, end, new Vector3(1, 2, 1), new Vector3(0, 0, 5), 0);
  assert.deepEqual(root.quaternion.toArray(), keptRoot);
  assert.deepEqual(mid.quaternion.toArray(), keptMid);
});
