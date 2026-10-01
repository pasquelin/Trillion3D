import test from 'node:test';
import assert from 'node:assert/strict';
import { capsulePass, type CapsuleContact } from './capsule.ts';
import { buildTriangleTree } from './triangleTree.ts';
import { meshCollision } from './meshTriangles.ts';
import { closestBetweenSegments } from './segmentPair.ts';
import { block } from './character.fixture.ts';
import { near } from '../math/near.fixture.ts';

const RADIUS = 0.25,
  HEIGHT = 1.75;

/** Every contact of one pass of an upright capsule standing on `feet` against `triangles`, the
 *  capsule left in place. */
function contacts(triangles: ArrayLike<number>, feet: number[]) {
  const seen: { normal: number[]; depth: number; point: number[] }[] = [];
  const capsule = { feet: new Float64Array(feet), radius: RADIUS, height: HEIGHT };
  capsulePass(buildTriangleTree(triangles), capsule, (touch: CapsuleContact) =>
    seen.push({ normal: [...touch.normal], depth: touch.depth, point: [...touch.point] }),
  );
  return seen;
}

test("beside a box's face, its diagonal is met as the face, at the face", () => {
  // The capsule's axis runs 0.2 from the face, alongside it, across the height where the face's
  // two triangles meet: every contact is the face's, at the face, 0.05 deep.
  const triangles = meshCollision([block(1, 1.4, -3, 2, 1.8, 3)]).tree.triangles;
  for (const z of [-1, 0, 0.7]) {
    const seen = contacts(triangles, [0.8, 0, z]);
    assert.ok(seen.length > 0);
    for (const { normal, depth, point } of seen) {
      near(normal, [-1, 0, 0], 'normal', 1e-12);
      assert.ok(Math.abs(depth - 0.05) < 1e-12, `depth ${depth}`);
      assert.equal(point[0], 1);
      assert.ok(
        Math.abs(point[2] - z) < 1e-12 && point[1] >= Math.fround(1.4) && point[1] <= 1.5,
        `${point}`,
      );
    }
  }
});

test('above a ridge folded less than 5°, each half holds the body along its own normal', () => {
  // Two halves of a ridge along z, each 2° from level: the sphere 0.15 above the ridge's line is
  // 0.15 cos 2° from each half's plane.
  const slope = Math.tan((2 * Math.PI) / 180) * 5;
  const ridge = [-5, -slope, -5, 0, 0, 5, 0, 0, -5, 0, 0, -5, 0, 0, 5, 5, -slope, 5];
  const seen = contacts(ridge, [0, -0.1, 0]);
  const [sin, cos] = [Math.sin((2 * Math.PI) / 180), Math.cos((2 * Math.PI) / 180)];
  assert.equal(seen.length, 2);
  for (const { normal, depth } of seen) {
    near(normal, [Math.sign(normal[0]) * sin, cos, 0], 'normal', 1e-6);
    assert.ok(Math.abs(depth - (RADIUS - 0.15 * cos)) < 1e-6, `depth ${depth}`);
  }
  assert.ok(seen[0].normal[0] * seen[1].normal[0] < 0, 'one from each half');
});

test('a segment through a flat surface meets its seam as the edge it is drawn as', () => {
  // A 45° slope split along its diagonal; the capsule's axis pierces it beside the diagonal, as
  // inside a solid: the triangle it does not pierce is met at the diagonal, as an edge.
  const [a, b, c, d] = [
    [0, 0, -2],
    [2, 2, 2],
    [2, 2, -2],
    [0, 0, 2],
  ];
  const slope = [...a, ...b, ...c, ...b, ...a, ...d];
  const feet = [1, 0.5, 0.05];
  const axis = [1, 0.5 + RADIUS, 0.05, 1, 0.5 + HEIGHT - RADIUS, 0.05];
  const pair = new Float64Array(6);
  const gap = Math.sqrt(closestBetweenSegments(pair, axis, [...a, ...b]));
  const edge = [0, 1, 2].map((k) => (pair[k] - pair[3 + k]) / gap);
  const seen = contacts(slope, feet);
  assert.ok(
    seen.some(({ normal }) => normal.every((value, k) => Math.abs(value - edge[k]) < 1e-9)),
    `${seen.map(({ normal }) => normal)} lack ${edge}`,
  );
});
