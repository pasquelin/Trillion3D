import test from 'node:test';
import assert from 'node:assert/strict';
import { dropSphere } from './drop.ts';
import type { CapsuleContact } from './capsule.ts';

const contact = (): CapsuleContact => ({
  point: new Float64Array(3),
  normal: new Float64Array(3),
  surface: new Float64Array(3),
  depth: 0,
});
const near = (actual: ArrayLike<number>, expected: number[]) =>
  Array.from(actual).forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-10));

test('sphere ground probes retain face, edge and vertex contacts with both windings and nonzero offsets', () => {
  const corners = [
    [0, 2, 0],
    [6, 2, 0],
    [0, 2, 6],
  ];
  for (const reverse of [false, true]) {
    const triangle = [99, 98, 97, ...(reverse ? corners.toReversed() : corners).flat()];
    for (const [centre, expectedPoint, expectedNormal, distance] of [
      [[1, 8, 1], [1, 2, 1], [0, 1, 0], 5],
      [[3, 8, -0.6], [3, 2, 0], [0, 0.8, -0.6], 5.2],
      [[-0.6, 8, 3], [0, 2, 3], [-0.6, 0.8, 0], 5.2],
      [[-0.6, 8, -0.6], [0, 2, 0], [-0.6, Math.sqrt(0.28), -0.6], 6 - Math.sqrt(0.28)],
      [[1, 2.5, 1], [1, 2, 1], [0, 1, 0], -0.5],
    ] as const) {
      const touch = contact();
      assert.ok(Math.abs(dropSphere(centre, 1, triangle, 3, touch) - distance) < 1e-10);
      near(touch.point, [...expectedPoint]);
      near(touch.normal, [...expectedNormal]);
      near(touch.surface, [0, 1, 0]);
    }
    assert.equal(dropSphere([20, 8, 20], 1, triangle, 3, contact()), Infinity);
  }
  assert.equal(dropSphere([0, 8, 0], 1, new Float32Array(9), 0, contact()), Infinity);
});

test('slanted faces and vertical edges report actual contact geometry rather than flat-ground assumptions', () => {
  const triangle = [0, 0, 0, 8, 0, 0, 0, 8, 8];
  const touch = contact(),
    distance = dropSphere([2, 10, 2], 1, triangle, 0, touch);
  assert.ok(Math.abs(distance - (8 - Math.SQRT2)) < 1e-10);
  near(touch.surface, [0, Math.SQRT1_2, -Math.SQRT1_2]);
  near(touch.normal, [0, Math.SQRT1_2, -Math.SQRT1_2]);
  near(touch.point, [2, 2 + Math.SQRT1_2, 2 + Math.SQRT1_2]);
  const vertical = [0, 0, 0, 0, 6, 0, 0, 0, 6];
  const edge = contact();
  assert.ok(Number.isFinite(dropSphere([0.6, 10, 0], 1, vertical, 0, edge)));
  assert.equal(dropSphere([2, 10, 0], 1, vertical, 0, contact()), Infinity);
});

test('translated slanted edge contacts have radius-scaled normals and the expected swept height', () => {
  // A sphere centred above the midpoint of a 45-degree edge touches its upper side.
  // Its centre is sqrt(2) radii above that midpoint; its contact is displaced along the edge.
  const triangle = [3, 4, 5, 7, 8, 5, 3, 4, 9];
  for (const radius of [0.5, 2]) {
    const touch = contact();
    const distance = dropSphere([5, 20, 5 - radius * 0.6], radius, triangle, 0, touch);
    const vertical = radius * 0.8 * Math.SQRT2;
    assert.ok(Math.abs(distance - (14 - vertical)) < 1e-10);
    near(touch.point, [5 + vertical / 2, 6 + vertical / 2, 5]);
    near(touch.normal, [-0.8 * Math.SQRT1_2, 0.8 * Math.SQRT1_2, -0.6]);
  }
});
