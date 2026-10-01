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
function contacts(triangles: number[], feet: number[]) {
  const seen: { normal: number[]; depth: number; point: number[] }[] = [];
  const capsule = { feet: new Float64Array(feet), radius: RADIUS, height: HEIGHT };
  capsulePass(buildTriangleTree(triangles), capsule, (touch: CapsuleContact) =>
    seen.push({ normal: [...touch.normal], depth: touch.depth, point: [...touch.point] }),
  );
  return seen;
}

/** The way out of the edge `(p, q)` itself for an upright capsule on `feet`: from the edge's
 *  nearest point to the capsule's axis. */
function edgeWayOut(p: number[], q: number[], feet: number[]) {
  const axis = [feet[0], feet[1] + RADIUS, feet[2], feet[0], feet[1] + HEIGHT - RADIUS, feet[2]];
  const pair = new Float64Array(6);
  const length = Math.sqrt(closestBetweenSegments(pair, axis, [...p, ...q]));
  return [0, 1, 2].map((k) => (pair[k] - pair[3 + k]) / length);
}

const has = (seen: { normal: number[] }[], normal: number[]) =>
  seen.some((touch) => touch.normal.every((value, k) => Math.abs(value - normal[k]) < 1e-9));

/** A wall in the plane x = 0, from z = -3 to 3 and y = 1 to 2, facing -x, split along its
 *  diagonal from (0, 1, -3) to (0, 2, 3); `flip` winds its second half backwards. */
function wall(flip = false) {
  const [a, b, c, d] = [
    [0, 1, -3],
    [0, 2, 3],
    [0, 2, -3],
    [0, 1, 3],
  ];
  return [...a, ...b, ...c, ...(flip ? [a, b, d] : [b, a, d]).flat()];
}

test("beside a flat wall, a capsule leaves it along the wall's normal wherever its seam runs", () => {
  for (const flip of [false, true])
    for (const z of [-0.2, 0.4, 1.3]) {
      const seen = contacts(wall(flip), [-0.2, 0, z]);
      assert.ok(seen.length > 0);
      for (const { normal, depth } of seen) {
        near(normal, [-1, 0, 0], `normal at ${z}`, 1e-12);
        assert.ok(Math.abs(depth - (RADIUS - 0.2)) < 1e-12, `depth ${depth}`);
      }
    }
});

test('a wall turned about the vertical is still one flat surface, its seam not an edge', () => {
  // Turned 30°, the wall's normal has a part along z: the planes compare in full. Its corners are
  // stored as float32, a few 1e-8 off the turned plane.
  const turn = Math.PI / 6;
  const at = ([x, y, z]: number[]) => [
    x * Math.cos(turn) - z * Math.sin(turn),
    y,
    x * Math.sin(turn) + z * Math.cos(turn),
  ];
  const triangles = [];
  for (let i = 0; i < wall().length; i += 3) triangles.push(...at(wall().slice(i, i + 3)));
  const feet = at([-0.2, 0, 0.4]);
  for (const { normal } of contacts(triangles, feet)) near(normal, at([-1, 0, 0]), 'normal', 1e-6);
});

/** Two triangles sharing the upright seam from (0, 1, 0) to (0, 2, 0): one in the plane x = 0
 *  towards -z, the other turned by `turn` about the seam, away from a body on the -x side. */
function fold(turn: number) {
  const [p, q] = [
    [0, 1, 0],
    [0, 2, 0],
  ];
  return [...p, ...q, 0, 1.5, -3, ...q, ...p, 3 * Math.sin(turn), 1.5, 3 * Math.cos(turn)];
}

test('a fold steeper than 5° is a crease, met along the slant from its line', () => {
  // Beside the seam, on the side of the turned half: folded 30°, the seam is an edge of the
  // surface and is met as one; folded 2°, the faces alone are met.
  const feet = [-0.2, 0, 0.05];
  const edge = edgeWayOut([0, 1, 0], [0, 2, 0], feet);
  assert.ok(has(contacts(fold(Math.PI / 6), feet), edge));
  const flat = contacts(fold(Math.PI / 90), feet);
  assert.ok(flat.length > 0 && !has(flat, edge));
  for (const { normal } of flat)
    assert.ok(Math.abs(normal[1]) < 1e-12 && Math.abs(normal[2]) <= Math.sin(Math.PI / 90) + 1e-9);
});

test('an edge no other triangle shares is a crease', () => {
  // The wall's first half alone: its diagonal is its border.
  const feet = [-0.2, 0, 0.4];
  const edge = edgeWayOut([0, 1, -3], [0, 2, 3], feet);
  const seen = contacts(wall().slice(0, 9), feet);
  assert.ok(has(seen, edge), `${seen.map(({ normal }) => normal)}`);
});

test('an edge three triangles share is a crease', () => {
  // A flat wall with a fin standing on its seam: the seam is where the surface branches.
  const feet = [-0.2, 0, 0.4];
  const fin = [0, 1, -3, 0, 2, 3, -1, 1.5, 0];
  assert.ok(has(contacts([...wall(), ...fin], feet), edgeWayOut([0, 1, -3], [0, 2, 3], feet)));
});

test('an edge shared with a triangle of no area is a crease', () => {
  // A sliver along the seam, its third corner on the seam's line: it has no plane to be flat in.
  const feet = [-0.2, 0, 0.4];
  const sliver = [0, 1, -3, 0, 2, 3, 0, 1.5, 0];
  const seen = contacts([...wall().slice(0, 9), ...sliver], feet);
  assert.ok(has(seen, edgeWayOut([0, 1, -3], [0, 2, 3], feet)));
});

test("a corner inside a flat surface is not a corner; a box's corner is", () => {
  // Four triangles of the plane x = 0 around (0, 1.5, 0): a body beside that corner meets the
  // plane alone.
  const centre = [0, 1.5, 0];
  const rim = [
    [0, 1, -3],
    [0, 1, 3],
    [0, 2, 3],
    [0, 2, -3],
  ];
  const fan = rim.flatMap((corner, i) => [...centre, ...corner, ...rim[(i + 1) % 4]]);
  const flat = contacts(fan, [-0.2, 0, 0]);
  assert.ok(flat.length > 0);
  for (const { normal } of flat) near(normal, [-1, 0, 0], 'normal', 1e-12);
  // A box's corner is a crease: a body against it leaves it diagonally.
  const world = meshCollision([block(0, 0, 0, 1, 2, 1)]);
  const capsule = { feet: new Float64Array([-0.1, 0, -0.1]), radius: RADIUS, height: HEIGHT };
  const seen: number[][] = [];
  world.resolveCapsule(capsule, (touch) => seen.push([...touch.normal]));
  assert.ok(seen.length > 0);
  for (const normal of seen) near(normal, [-Math.SQRT1_2, 0, -Math.SQRT1_2], 'normal', 1e-9);
});
