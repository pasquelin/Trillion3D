import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoBoneIK } from './ik.ts';
import { ikChain } from './ikChain.fixture.ts';
import { Vector3 } from '../math/vector3.ts';

test('final pole alignment publishes the solved joint matrices before any lazy position read', () => {
  const { root, mid, end } = ikChain(3, 2);
  solveTwoBoneIK(root, mid, end, new Vector3(1, 2, 1), new Vector3(0, 0, 5));
  const cachedMid = new Vector3().setFromMatrixPosition(mid.matrixWorld);
  const cachedEnd = new Vector3().setFromMatrixPosition(end.matrixWorld);
  assert.ok(cachedMid.distanceTo(mid.getWorldPosition()) < 1e-9);
  assert.ok(cachedEnd.distanceTo(end.getWorldPosition()) < 1e-9);
});

test('a zero-length second bone does not spuriously twist attachments about its unchanged axis', () => {
  const { root, mid, end } = ikChain(1, 0);
  mid.position.set(1, 1, -2);
  solveTwoBoneIK(root, mid, end, mid.position.clone(), new Vector3(1, -1, 0));
  assert.ok(
    new Vector3(1, 0, 0).applyQuaternion(root.quaternion).distanceTo(new Vector3(1, 0, 0)) < 1e-9,
  );
  assert.ok(end.getWorldPosition().distanceTo(mid.position) < 1e-9);
});

test('negligible preexisting bends do not introduce a sudden attachment roll at a pole', () => {
  for (const [first, second] of [
    [1, 1],
    [3, 2],
  ]) {
    const axes = [0, second * 1e-9].map((bend) => {
      const { root, mid, end } = ikChain(first, second);
      end.position.x = bend;
      solveTwoBoneIK(root, mid, end, new Vector3(0, 1, 0), new Vector3(0, 0, 5));
      return new Vector3(1, 0, 0).applyQuaternion(root.quaternion);
    });
    assert.ok(axes[0].distanceTo(axes[1]) < 1e-7);
  }
});
