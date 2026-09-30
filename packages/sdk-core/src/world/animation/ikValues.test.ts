import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoBoneIK } from './ik.ts';
import { Object3D } from '../object/object3d.ts';
import { Vector3 } from '../math/vector3.ts';

function chain() {
  const parent = new Object3D(),
    root = new Object3D(),
    mid = new Object3D(),
    end = new Object3D();
  parent.position.set(4, -2, 3);
  parent.rotation.set(0.3, -0.5, 0.8);
  parent.add(root);
  root.add(mid);
  mid.add(end);
  mid.position.set(0, 3, 0);
  end.position.set(0, 2, 0);
  parent.updateMatrixWorld(true);
  return { parent, root, mid, end };
}

test('two-bone IK reaches arbitrary world targets while keeping both lengths and root position', () => {
  for (const offset of [
    [2, 1, 2],
    [-2, 3, -1],
    [0, -3, 0],
    [3, 0, 0],
  ]) {
    const { root, mid, end } = chain();
    const start = root.getWorldPosition(new Vector3());
    const target = start.clone().add(new Vector3(offset[0], offset[1], offset[2]));
    const pole = start.clone().add(new Vector3(2, 3, 4));
    solveTwoBoneIK(root, mid, end, target, pole);
    const a = root.getWorldPosition(new Vector3()),
      b = mid.getWorldPosition(new Vector3()),
      c = end.getWorldPosition(new Vector3());
    assert.ok(a.distanceTo(start) < 1e-9);
    assert.ok(Math.abs(a.distanceTo(b) - 3) < 1e-9);
    assert.ok(Math.abs(b.distanceTo(c) - 2) < 1e-9);
    assert.ok(c.distanceTo(target) < 1e-6, `${c.toArray()} target ${target.toArray()}`);
    assert.ok(Math.abs(root.quaternion.length() - 1) < 1e-9);
    assert.ok(Math.abs(mid.quaternion.length() - 1) < 1e-9);
  }
});

test('IK weights preserve zero poses, blend partial rotations and clamp overshoot', () => {
  for (const weight of [-1, 0, 0.25, 0.5, 1, 2]) {
    const a = chain(),
      full = chain(),
      target = new Vector3(6, 0, 4);
    solveTwoBoneIK(full.root, full.mid, full.end, target);
    const expectedRoot = a.root.quaternion
      .clone()
      .slerp(full.root.quaternion, Math.min(1, Math.max(0, weight)));
    const expectedMid = a.mid.quaternion
      .clone()
      .slerp(full.mid.quaternion, Math.min(1, Math.max(0, weight)));
    solveTwoBoneIK(a.root, a.mid, a.end, target, undefined, weight);
    assert.ok(a.root.quaternion.angleTo(expectedRoot) < 1e-6);
    assert.ok(a.mid.quaternion.angleTo(expectedMid) < 1e-6);
    const local = a.end.position.clone().applyMatrix4(a.end.matrixWorld);
    assert.ok(Number.isFinite(local.length()));
  }
});

test('straight chains use a fallback bending plane and unreachable targets stop at full reach', () => {
  for (const axis of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]) {
    const root = new Object3D(),
      mid = new Object3D(),
      end = new Object3D();
    root.add(mid);
    mid.add(end);
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

test('opposite IK poles choose mirrored elbows for the same reachable endpoint', () => {
  for (const sign of [-1, 1]) {
    const root = new Object3D(),
      mid = new Object3D(),
      end = new Object3D();
    root.add(mid);
    mid.add(end);
    mid.position.set(0, 1, 0);
    end.position.set(0, 1, 0);
    solveTwoBoneIK(root, mid, end, new Vector3(1, 1, 0), new Vector3(0, 0, sign));
    const elbow = mid.getWorldPosition(new Vector3());
    assert.ok(elbow.distanceTo(new Vector3(0.5, 0.5, sign * Math.SQRT1_2)) < 1e-8);
    // Solve again from the bent pose: the previous bend must be removed before the new one.
    solveTwoBoneIK(root, mid, end, new Vector3(-1, 0, 1));
    assert.ok(end.getWorldPosition(new Vector3()).distanceTo(new Vector3(-1, 0, 1)) < 1e-8);
  }
});
