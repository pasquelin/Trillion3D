import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTriangleTree } from './triangleTree.ts';
import { nearestTriangleOnRay } from './triangleQuery.ts';

test('oblique rays hit the named point with non-unit directions and reject surrounding misses', () => {
  for (const axis of [0, 1, 2]) {
    const permute = (v: number[]) => [v[axis], v[(axis + 1) % 3], v[(axis + 2) % 3]];
    const tree = buildTriangleTree([
      ...permute([4, 5, 6]),
      ...permute([8, 5, 6]),
      ...permute([4, 9, 6]),
      ...permute([20, 30, 40]),
      ...permute([24, 30, 40]),
      ...permute([20, 34, 40]),
    ]);
    for (const [o, d, expected] of [
      [[1, 0, 0], [2, 3, 3], 2],
      [[9, 12, 12], [-2, -3, -3], 2],
      [[5, 6, 8], [0, 0, -2], 1],
      [[5, 6, 4], [0, 0, -2], null],
      [[7, 8, 8], [0, 0, -2], null],
      [[4, 5, 8], [0, 0, -2], 1],
    ] as const) {
      const hit = nearestTriangleOnRay(tree, permute([...o]), permute([...d]));
      if (expected === null) assert.equal(hit, null);
      else assert.equal(hit?.t, expected);
    }
  }
});

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

test('ray leaves containing behind, coplanar and degenerate triangles still return the real forward face', () => {
  const tree = buildTriangleTree([
    -3, -3, -5, 3, -3, -5, -3, 3, -5, -3, -3, 10, 3, -3, 10, -3, 3, 10, -1, -1, 2, -1, -1, 2, -1,
    -1, 2, -1, -3, 3, -1, 3, 3, -1, -3, 7,
  ]);
  const hit = nearestTriangleOnRay(tree, [-1, -1, 0], [0, 0, 1]);
  assert.equal(hit?.t, 10);
  assert.equal(tree.triangles[hit!.at + 2], 10);
});

test('spatially separated leaves keep every nearest crossing in translated nonuniform boxes', () => {
  const points = [
    [-40, 8, -20],
    [3, -12, 50],
    [20, 30, 7],
    [-5, -4, 3],
    [60, 2, -8],
    [10, -30, 9],
    [-20, 40, 11],
    [80, -10, 40],
    [30, 15, -50],
  ];
  points.push(...points.map(([x, y, z]) => [x + 100, y - 100, z + 50]));
  const tree = buildTriangleTree(
    points.flatMap(([x, y, z]) => [x, y, z, x + 1, y, z, x, y + 1, z]),
  );
  for (const [x, y, z] of points)
    for (const sign of [-1, 1]) {
      const hit = nearestTriangleOnRay(tree, [x + 0.2, y + 0.2, z - sign * 4], [0, 0, sign * 2]);
      assert.equal(hit?.t, 2);
      assert.equal(tree.triangles[hit!.at], x);
      assert.equal(tree.triangles[hit!.at + 1], y);
      assert.equal(tree.triangles[hit!.at + 2], z);
    }
});
