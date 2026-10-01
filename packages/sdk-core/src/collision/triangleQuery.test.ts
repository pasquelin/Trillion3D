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
    ] as const) {
      const min = [-3, -3, -3],
        max = [3, 3, 3],
        found: number[] = [];
      min[axis] = low;
      max[axis] = high;
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

// Sharing one stack, a nested query would leave the outer one walking its nodes forever.
test(
  'a query asked from inside a visit answers alone, and the outer query goes on',
  { timeout: 5000 },
  () => {
    // Sixty-four small triangles in a row: a tree deep enough that the outer query still holds
    // nodes to open while the inner one runs.
    const tree = buildTriangleTree(
      Array.from({ length: 64 }, (_, i) => [i, 0, 0, i + 0.5, 0, 0, i, 1, 0]).flat(),
    );
    const all = [-100, -100, -100],
      top = [100, 100, 100];
    const alone: number[] = [];
    forEachTriangleInBox(tree, all, top, (at) => alone.push(at));
    const outer: number[] = [];
    forEachTriangleInBox(tree, all, top, (at) => {
      outer.push(at);
      const inner: number[] = [];
      forEachTriangleInBox(tree, all, top, (other) => inner.push(other));
      assert.deepEqual(inner, alone);
      assert.equal(nearestTriangleOnRay(tree, [10.2, 0.2, -1], [0, 0, 1])?.t, 1);
    });
    assert.deepEqual(outer, alone);
    // A visit that throws leaves the next query whole.
    assert.throws(() =>
      forEachTriangleInBox(tree, all, top, () => {
        throw new Error('stop');
      }),
    );
    const after: number[] = [];
    forEachTriangleInBox(tree, all, top, (at) => after.push(at));
    assert.deepEqual(after, alone);
  },
);
