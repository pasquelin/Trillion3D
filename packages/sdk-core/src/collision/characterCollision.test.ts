import test from 'node:test';
import assert from 'node:assert/strict';
import { triangleCollision } from './characterCollision.ts';
import { buildTriangleTree } from './triangleTree.ts';

/** A level square floor at height `y`, its two triangles wound up, or down when `down`. */
function floor(y: number, down: boolean) {
  const corners = [
    [-10, y, -10],
    [-10, y, 10],
    [10, y, 10],
    [10, y, -10],
  ];
  const [a, b, c, d] = down ? corners.toReversed() : corners;
  return triangleCollision(buildTriangleTree([a, b, c, a, c, d].flat()));
}

test('feet put on a floor at any height rest on it, wound either way', () => {
  for (const down of [false, true])
    for (const y of [-4, -1, 0, 0.5, 1, 1.5, 2, 3, 8, 100]) {
      const world = floor(y, down);
      for (const radius of [0.2, 0.3, 0.31, 0.35, 0.4]) {
        const capsule = { feet: new Float64Array([0.57, y, 0]), radius, height: 1.75 };
        // Asked with no depth to search: the floor the feet are on is still found, at 0.
        const drop = world.groundBelow(capsule, 0, () => true);
        assert.ok(drop !== null && Math.abs(drop) < 1e-12, `${drop} at ${y}, radius ${radius}`);
        assert.deepEqual([...capsule.feet], [0.57, y, 0], 'the feet are left where they were');
      }
    }
});

test('the ground below is the highest support the filter accepts, within the depth', () => {
  const world = triangleCollision(
    buildTriangleTree([
      ...[-10, 0, -10, -10, 0, 10, 10, 0, 10],
      ...[-10, -2, -10, -10, -2, 10, 10, -2, 10],
    ]),
  );
  const capsule = { feet: new Float64Array([1, 0.5, 2]), radius: 0.3, height: 1.75 };
  assert.ok(Math.abs(world.groundBelow(capsule, 1, () => true)! - 0.5) < 1e-12);
  // The upper floor refused, the lower one is found only when the depth reaches it.
  const lower = (touch: { point: Float64Array }) => touch.point[1] < -1;
  assert.equal(world.groundBelow(capsule, 1, lower), null);
  assert.ok(Math.abs(world.groundBelow(capsule, 3, lower)! - 2.5) < 1e-12);
  // Sunk 0.5 into the lower floor, the body must rise 0.5; the upper floor, above its head, is
  // a ceiling, never ground.
  const sunk = { feet: new Float64Array([1, -2.5, 2]), radius: 0.3, height: 1.75 };
  assert.ok(Math.abs(world.groundBelow(sunk, 1, () => true)! + 0.5) < 1e-12);
});

test('two floors in reach: the higher is the ground, whichever the tree reads first', () => {
  const upper = [-10, 0, -10, -10, 0, 10, 10, 0, 10],
    lower = [-10, -1, -10, -10, -1, 10, 10, -1, 10];
  for (const triangles of [
    [...upper, ...lower],
    [...lower, ...upper],
  ]) {
    const world = triangleCollision(buildTriangleTree(triangles));
    const capsule = { feet: new Float64Array([1, 0.5, 2]), radius: 0.3, height: 1.75 };
    assert.ok(Math.abs(world.groundBelow(capsule, 3, () => true)! - 0.5) < 1e-12);
  }
});

test('a floor anywhere inside the body is ground to rise onto, one above its head is not', () => {
  // Sunk 1 m into a floor, more than the bottom sphere's diameter but under the body's height.
  const world = triangleCollision(buildTriangleTree([-10, 0, -10, -10, 0, 10, 10, 0, 10]));
  const sunk = { feet: new Float64Array([1, -1, 2]), radius: 0.3, height: 1.75 };
  assert.ok(Math.abs(world.groundBelow(sunk, 0, () => true)! + 1) < 1e-12);
  const below = { feet: new Float64Array([1, -2, 2]), radius: 0.3, height: 1.75 };
  assert.equal(
    world.groundBelow(below, 0, () => true),
    null,
  );
});

test("a wall's top corner brushed at the sphere's widest is not ground", () => {
  // A vertical triangle; the sphere's centre passes exactly one radius beside its top corner,
  // which it meets level with its centre: the way out is level, nothing holds the body up.
  const world = triangleCollision(buildTriangleTree([0, 1, 0, 0, 0, -1, 0, 0, 1]));
  const beside = { feet: new Float64Array([0.3, 2, 0]), radius: 0.3, height: 1.75 };
  assert.equal(
    world.groundBelow(beside, 5, () => true),
    null,
  );
});
