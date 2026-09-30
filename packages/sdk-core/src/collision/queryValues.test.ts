import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTriangleTree } from './triangleTree.ts';
import { forEachTriangleInBox, nearestTriangleOnRay } from './triangleQuery.ts';

function planes(axis: number, reverse = false) {
  const points: number[] = [];
  for (const location of [7, -4, 12, 2, -9, 20, -15, 30, -25]) {
    const corners = [
      [-3, -3, -3],
      [3, 3, 3],
      [-3, -3, -3],
    ];
    const other = [0, 1, 2].filter((value) => value !== axis);
    corners[1][other[1]] = -3;
    corners[2][other[1]] = 3;
    for (const corner of corners) corner[axis] = location;
    if (reverse) corners.reverse();
    points.push(...corners.flat());
  }
  return buildTriangleTree(points);
}

test('ray queries select nearest crossings on every axis, both faces and signed directions', () => {
  for (const axis of [0, 1, 2])
    for (const reverse of [false, true]) {
      const tree = planes(axis, reverse),
        retained = tree.triangles.slice();
      for (const [start, sign, expected, distance] of [
        [0, 1, 2, 2],
        [0, -1, -4, 4],
        [2, 1, 2, 0],
        [40, -1, 30, 10],
        [-40, 1, -25, 15],
      ]) {
        const origin = [0, 0, 0],
          direction = [0, 0, 0];
        origin[axis] = start;
        direction[axis] = sign;
        const result = nearestTriangleOnRay(tree, origin, direction);
        assert.ok(result);
        assert.ok(result.t === distance);
        assert.equal(tree.triangles[result.at + axis], expected);
      }
      const away = [0, 0, 0],
        direction = [0, 0, 0];
      away[axis] = 40;
      direction[axis] = 1;
      assert.equal(nearestTriangleOnRay(tree, away, direction), null);
      const outside = [10, 10, 10];
      outside[axis] = 0;
      assert.equal(nearestTriangleOnRay(tree, outside, direction), null);
      assert.equal(nearestTriangleOnRay(tree, [0, 0, 0], [0, 0, 0]), null);
      assert.deepEqual(tree.triangles, retained);
    }
  const empty = buildTriangleTree([]);
  assert.equal(nearestTriangleOnRay(empty, [0, 0, 0], [1, 0, 0]), null);
  const degenerate = buildTriangleTree([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(nearestTriangleOnRay(degenerate, [0, 0, 1], [0, 0, -1]), null);
});

test('box queries include boundary contact and visit only triangles within each axis range', () => {
  for (const axis of [0, 1, 2]) {
    const tree = planes(axis);
    for (const [low, high, expected] of [
      [-4, 7, [-4, 2, 7]],
      [2, 2, [2]],
      [-100, 100, [-25, -15, -9, -4, 2, 7, 12, 20, 30]],
      [31, 40, []],
    ]) {
      const min = [-3, -3, -3],
        max = [3, 3, 3],
        found: number[] = [];
      min[axis] = low as number;
      max[axis] = high as number;
      forEachTriangleInBox(tree, min, max, (at) => found.push(tree.triangles[at + axis]));
      assert.deepEqual(
        found.sort((a, b) => a - b),
        expected,
      );
    }
    for (const other of [0, 1, 2].filter((value) => value !== axis)) {
      const min = [-100, -100, -100],
        max = [100, 100, 100];
      min[other] = 4;
      let visits = 0;
      forEachTriangleInBox(tree, min, max, () => visits++);
      assert.equal(visits, 0);
      min[other] = -100;
      max[other] = -4;
      forEachTriangleInBox(tree, min, max, () => visits++);
      assert.equal(visits, 0);
    }
  }
  forEachTriangleInBox(buildTriangleTree([]), [-1, -1, -1], [1, 1, 1], () =>
    assert.fail('empty tree'),
  );
});

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
