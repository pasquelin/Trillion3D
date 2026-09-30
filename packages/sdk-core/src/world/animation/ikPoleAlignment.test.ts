import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoBoneIK } from './ik.ts';
import { ikChain } from './ikChain.fixture.ts';
import { Vector3 } from '../math/vector3.ts';

test('pole places the elbow in the target plane on the first solve and repeated solves stay still', () => {
  for (const shift of [new Vector3(), new Vector3(4, -2, 7)]) {
    const { root, mid, end } = ikChain(3, 2);
    root.position.copy(shift);
    const targetOffset = new Vector3(1, 2, 1);
    const poleOffset = new Vector3(0, 0, 5);
    const target = targetOffset.clone().add(shift);
    const pole = poleOffset.clone().add(shift);
    // Intersect the radius-3 sphere around root with the radius-2 sphere around target.
    const along = (9 - 4 + targetOffset.lengthSq()) / (2 * targetOffset.lengthSq());
    const centre = targetOffset.clone().multiplyScalar(along);
    const radius = Math.sqrt(9 - centre.lengthSq());
    const across = poleOffset
      .clone()
      .addScaledVector(targetOffset, -poleOffset.dot(targetOffset) / targetOffset.lengthSq())
      .normalize();
    const expected = centre.addScaledVector(across, radius).add(shift);
    for (let repeat = 0; repeat < 3; repeat++) {
      solveTwoBoneIK(root, mid, end, target, pole);
      assert.ok(mid.getWorldPosition(new Vector3()).distanceTo(expected) < 1e-7);
      const elbow = mid.getWorldPosition(new Vector3());
      const tip = end.getWorldPosition(new Vector3());
      assert.ok(tip.distanceTo(target) < 1e-7);
      assert.ok(Math.abs(elbow.distanceTo(shift) - 3) < 1e-7);
      assert.ok(Math.abs(tip.distanceTo(elbow) - 2) < 1e-7);
    }
  }
});
