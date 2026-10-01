import test from 'node:test';
import assert from 'node:assert/strict';
import { dropSphere } from './drop.ts';
import type { CapsuleContact } from './capsule.ts';
import { near } from '../math/near.fixture.ts';

const contact = (): CapsuleContact => ({
  point: new Float64Array(3),
  normal: new Float64Array(3),
  surface: new Float64Array(3),
  depth: 0,
});

test('a level triangle wound either way meets the sphere on its face, edges and corner', () => {
  const corners = [
    [0, 2, 0],
    [6, 2, 0],
    [0, 2, 6],
  ];
  for (const reverse of [false, true]) {
    // The triangle is read from `at` = 3: the three numbers before it are another's.
    const triangle = [99, 98, 97, ...(reverse ? corners.toReversed() : corners).flat()];
    // Centre, touched point, way out to the centre, distance lowered: a unit sphere 6 m above
    // the plane. Over the face it falls 5 m; past an edge by 0.6 it meets the edge 0.8 lower;
    // past the corner by 0.6 on both axes it meets the corner.
    const corner = Math.sqrt(1 - 2 * 0.6 ** 2);
    const cases: [number[], number[], number[], number][] = [
      [[1, 8, 1], [1, 2, 1], [0, 1, 0], 5],
      [[3, 8, -0.6], [3, 2, 0], [0, 0.8, -0.6], 5.2],
      [[-0.6, 8, 3], [0, 2, 3], [-0.6, 0.8, 0], 5.2],
      [[-0.6, 8, -0.6], [0, 2, 0], [-0.6, corner, -0.6], 6 - corner],
      // Already sunk half a radius into the face: it must rise.
      [[1, 2.5, 1], [1, 2, 1], [0, 1, 0], -0.5],
    ];
    for (const [centre, point, normal, distance] of cases) {
      const touch = contact();
      assert.ok(Math.abs(dropSphere(centre, 1, triangle, 3, touch) - distance) < 1e-10);
      near(touch.point, point, 'point', 1e-10);
      near(touch.normal, normal, 'normal', 1e-10);
      near(touch.surface, [0, 1, 0], 'surface', 1e-10);
    }
    assert.equal(dropSphere([20, 8, 20], 1, triangle, 3, contact()), Infinity);
  }
  assert.equal(dropSphere([0, 8, 0], 1, new Float32Array(9), 0, contact()), Infinity);
});

test('a probe reads only the triangle it is given, never the one stored after it', () => {
  const triangles = [0, 0, 0, 6, 0, 0, 0, 0, 6, 20, 5, 20, 21, 5, 20, 20, 5, 21];
  // Above the second triangle, and above a point past the first one's edges.
  assert.equal(dropSphere([20, 10, 20], 1, triangles, 0, contact()), Infinity);
  assert.equal(dropSphere([13, 10, 10], 1, triangles, 0, contact()), Infinity);
});

test('a slope is met on its face, its surface turned up whatever the axes', () => {
  // A 45° slope rising along z (or x): a unit sphere meets it where the face lies one radius
  // from the centre, √2 lower than over a level floor.
  for (const swap of [false, true]) {
    const turn = (x: number, y: number, z: number) => (swap ? [z, y, x] : [x, y, z]);
    const place = (x: number, y: number, z: number) =>
      turn(x, y, z).map((value, k) => value + [3, 4, 5][k]);
    const triangle = [...place(0, 0, 0), ...place(8, 0, 0), ...place(0, 8, 8)];
    const touch = contact();
    const distance = dropSphere(place(2, 10, 2), 1, triangle, 0, touch);
    assert.ok(Math.abs(distance - (8 - Math.SQRT2)) < 1e-10);
    near(touch.point, place(2, 2 + Math.SQRT1_2, 2 + Math.SQRT1_2), 'point', 1e-10);
    near(touch.surface, turn(0, Math.SQRT1_2, -Math.SQRT1_2), 'surface', 1e-10);
    near(touch.normal, [...touch.surface], 'normal', 1e-10);
  }
});

test('an edge is met where the sphere first comes one radius from it', () => {
  // A 45° edge from (3, 4, 5) to (7, 8, 5); the sphere passes 0.6 r beside its line, so it
  // meets the edge's upper side 0.8 r away across, √2 · 0.8 r above the edge vertically.
  const triangle = [3, 4, 5, 7, 8, 5, 3, 4, 9];
  for (const radius of [0.5, 2]) {
    const touch = contact();
    const distance = dropSphere([5, 20, 5 - radius * 0.6], radius, triangle, 0, touch);
    const above = radius * 0.8 * Math.SQRT2;
    assert.ok(Math.abs(distance - (14 - above)) < 1e-10);
    near(touch.point, [5 + above / 2, 6 + above / 2, 5], 'point', 1e-10);
    near(touch.normal, [-0.8 * Math.SQRT1_2, 0.8 * Math.SQRT1_2, -0.6], 'normal', 1e-10);
  }
  // A vertical triangle: the sphere beside it meets its slanted edge, its normal level.
  const wall = [0, 0, 0, 0, 0, 6, 0, 6, 0];
  const touch = contact();
  assert.equal(dropSphere([1, 10, 3], 1, wall, 0, touch), 7);
  near(touch.point, [0, 3, 3], 'point', 1e-10);
  near(touch.normal, [1, 0, 0], 'normal', 1e-10);
  assert.equal(dropSphere([2, 10, 0], 1, wall, 0, contact()), Infinity);
});

test('a vertical triangle keeps its face orientation, its contact normal pointing to the sphere', () => {
  const corners = [
    [0, 0, 0],
    [0, 6, 0],
    [0, 0, 6],
  ];
  for (const reverse of [false, true]) {
    const touch = contact();
    const triangle = (reverse ? corners.toReversed() : corners).flat();
    // 0.6 beside the top corner: met 0.8 above it.
    assert.ok(Math.abs(dropSphere([0.6, 10, 0], 1, triangle, 0, touch) - 3.2) < 1e-12);
    assert.deepEqual([...touch.surface], [reverse ? -1 : 1, 0, 0]);
    near(touch.normal, [0.6, 0.8, 0], 'normal', 1e-10);
  }
});

test('a corner out of reach of its two edges is still met, where the sphere reaches it', () => {
  // The sphere's centre is 3 and 4 beside the corner: radius 5, it touches the corner level
  // with its centre, after both edges fell away from under it.
  for (const [x, y, z] of [
    [0, 0, 0],
    [7, 2, 11],
  ]) {
    const triangle = [x, y, z, x + 20, y - 20, z, x, y - 20, z + 20];
    const touch = contact();
    assert.equal(dropSphere([x - 3, y + 10, z - 4], 5, triangle, 0, touch), 10);
    assert.deepEqual([...touch.point], [x, y, z]);
    assert.deepEqual([...touch.normal], [-0.6, 0, -0.8]);
  }
});

test('a vertical edge is met at its top end, whatever its length', () => {
  // 0.05 beside a vertical edge 0.7 tall: the top corner is met sqrt(r² - 0.05²) below the centre.
  const touch = contact();
  const distance = dropSphere([0, 10, 0.05], 0.1, [0, 0, 0, 0, 0.7, 0, 1, 0, 0], 0, touch);
  const below = Math.sqrt(0.1 ** 2 - 0.05 ** 2);
  assert.ok(Math.abs(distance - (10 - 0.7 - below)) < 1e-12);
  assert.deepEqual([...touch.point], [0, 0.7, 0]);
  near(touch.normal, [0, below / 0.1, 0.5], 'normal', 1e-10);
});
