import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTriangleTree } from './triangleTree.ts';
import { nearestTriangleOnRay } from './triangleQuery.ts';

test('rays on maximum box faces retain vertex hits with parallel components', () => {
  const tree = buildTriangleTree([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  for (const origin of [
    [2, 0, 3],
    [0, 2, 3],
  ]) {
    assert.deepEqual(nearestTriangleOnRay(tree, origin, [0, 0, -0.5]), { t: 6, at: 0 });
  }
});

test('ray parameters remain inverse to direction speed when entering a thin box', () => {
  const tree = buildTriangleTree([-2, -2, 5, 2, -2, 5, -2, 2, 5]);
  for (const [speed, parameter] of [
    [0.25, 20],
    [0.5, 10],
    [2, 2.5],
  ]) {
    assert.deepEqual(nearestTriangleOnRay(tree, [-1, -1, 0], [0, 0, speed]), {
      t: parameter,
      at: 0,
    });
  }
  assert.deepEqual(nearestTriangleOnRay(tree, [-5, -1, 0], [0.5, 0, 0.5]), { t: 10, at: 0 });
  assert.deepEqual(nearestTriangleOnRay(tree, [-3, -1, 0], [0.5, 0, 1]), { t: 5, at: 0 });
});

test('coincident nearest faces retain the first triangle in their leaf', () => {
  const tree = buildTriangleTree([-2, -2, 5, 2, -2, 5, -2, 2, 5, -2, 2, 5, 2, -2, 5, -2, -2, 5]);
  assert.deepEqual(nearestTriangleOnRay(tree, [-1, -1, 0], [0, 0, 1]), { t: 5, at: 0 });
});
