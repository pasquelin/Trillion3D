import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoBoneIK } from './ik.ts';
import { Object3D } from '../object/object3d.ts';
import { Vector3 } from '../math/vector3.ts';

test('near-collinear IK targets and poles retain a stable bend under uniform scene scaling', () => {
  for (const poleCase of [false, true]) {
    const elbows: Vector3[] = [];
    for (const scale of [0.1, 1, 10]) {
      const root = new Object3D(),
        mid = new Object3D(),
        end = new Object3D();
      root.add(mid);
      mid.add(end);
      mid.position.set(0, 3 * scale, 0);
      end.position.set(0, 2 * scale, 0);
      const target = (poleCase ? new Vector3(2, 1, 0) : new Vector3(0, 2, 1e-9)).multiplyScalar(
        scale,
      );
      const pole = poleCase ? new Vector3(0, 5, 1e-9).multiplyScalar(scale) : undefined;
      solveTwoBoneIK(root, mid, end, target, pole);
      elbows.push(mid.getWorldPosition().multiplyScalar(1 / scale));
      assert.ok(end.getWorldPosition().distanceTo(target) < scale * 1e-6);
    }
    assert.ok(elbows[0].distanceTo(elbows[1]) < 1e-6);
    assert.ok(elbows[2].distanceTo(elbows[1]) < 1e-6);
    assert.ok(Math.abs(elbows[1].z) < 1e-6);
  }
});

test('IK keeps an unreachable chain slightly bent so its next solve remains well-defined', () => {
  const root = new Object3D(),
    mid = new Object3D(),
    end = new Object3D();
  root.add(mid);
  mid.add(end);
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
