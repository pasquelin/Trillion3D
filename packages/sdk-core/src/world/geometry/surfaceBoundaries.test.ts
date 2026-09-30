import test from 'node:test';
import assert from 'node:assert/strict';
import { box, plane, sphere, circle, ring, cylinder } from './basic.ts';
import { torusKnot } from './round.ts';
import { turnPoint } from './sphere.ts';

test('decimal sheet endpoints stay exact and box texture origins retain face orientation', () => {
  const sheet = plane(0.1, 0.7, 3, 3),
    p = sheet.attributes.position;
  assert.equal(p.getX(0), -0.05);
  assert.equal(p.getY(0), -0.35);
  assert.equal(p.getX(15), 0.05);
  assert.equal(p.getY(15), 0.35);
  const g = box(6, 4, 2, 3, 2, 1),
    positions = g.attributes.position;
  const corners = [
    [0, [3, -2, 1]],
    [6, [-3, -2, -1]],
    [12, [-3, 2, 1]],
    [20, [-3, -2, -1]],
    [28, [-3, -2, 1]],
    [40, [3, -2, -1]],
  ] as const;
  for (const [i, expected] of corners)
    assert.deepEqual([positions.getX(i), positions.getY(i), positions.getZ(i)], expected);
  assert.equal(sphere().recipe!.type, 'sphere');
  assert.deepEqual(circle(2, 4, 1, 2).recipe, { type: 'circle', args: [2, 4, 1, 2] });
  assert.equal(ring().recipe!.type, 'ring');
});

test('a two-three torus knot passes its independently known crossing and height landmarks', () => {
  const g = torusKnot(2, 0.25, 8, 4, 2, 3),
    p = g.attributes.position;
  // Opposite vertices of the same tube ring have their midpoint on the centre curve.
  for (const [i, expected] of [
    [0, [3, 0, 0]],
    [2, [-2, 0, -1]],
    [4, [1, 0, 0]],
    [6, [-2, 0, 1]],
    [8, [3, 0, 0]],
  ] as const) {
    for (let c = 0; c < 3; c++)
      assert.ok(
        Math.abs((p.getComponent(i, c) + p.getComponent(18 + i, c)) / 2 - expected[c]) < 1e-8,
      );
  }
});

test('cylinder cap centers and rims stay on their corresponding end planes', () => {
  const g = cylinder(2, 4, 6, 4, 2),
    p = g.attributes.position;
  for (let i = 15; i < 27; i++) assert.equal(p.getY(i), i < 21 ? 3 : -3);
  for (const [first, radius] of [
    [16, 2],
    [22, 4],
  ]) {
    const rim = new Set(
      Array.from({ length: 5 }, (_, j) => [p.getX(first + j), p.getZ(first + j)].join(',')),
    );
    assert.deepEqual(rim, new Set([`0,${radius}`, `${radius},0`, `0,${-radius}`, `${-radius},0`]));
  }
});
test('a full arc starting away from zero rotates its first point by that offset', () => {
  const [x, y] = turnPoint(0, Math.PI / 2);
  assert.ok(Math.abs(x) < 1e-8);
  assert.equal(y, 1);
});
