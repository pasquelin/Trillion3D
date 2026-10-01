import test from 'node:test';
import assert from 'node:assert/strict';
import { capsulePass, type CapsuleContact } from './capsule.ts';
import { buildTriangleTree } from './triangleTree.ts';
import { meshCollision } from './meshTriangles.ts';
import { block } from './character.fixture.ts';
import { near } from '../math/near.fixture.ts';

/** Every contact of one pass of `capsule` against `triangles`, the capsule left in place. */
function contacts(triangles: number[], feet: number[], radius = 0.25, height = 1.75) {
  const seen: { normal: number[]; depth: number }[] = [];
  const capsule = { feet: new Float64Array(feet), radius, height };
  capsulePass(buildTriangleTree(triangles), capsule, (touch: CapsuleContact) =>
    seen.push({ normal: [...touch.normal], depth: touch.depth }),
  );
  return seen;
}

/** A wall in the plane x = 0, from z = -3 to 3 and y = 1 to 2, split along a diagonal; `turn`
 *  folds its second half by that angle about the diagonal's line, `flip` winds it backwards. */
function wall(turn = 0, flip = false) {
  const a = [0, 1, -3],
    b = [0, 2, 3],
    c = [0, 2, -3],
    d = [Math.sin(turn) * 6, 1, 3 - 6 + 6 * Math.cos(turn)];
  const second = flip ? [a, d, b] : [a, b, d];
  return [...a, ...c, ...b, ...second.flat()];
}

test("a capsule beside a flat wall leaves it along the wall's normal, wherever its seam runs", () => {
  // The capsule's axis, upright 0.2 from the wall, passes the diagonal seam of the wall's two
  // triangles: the seam's line is not an edge of the wall, nothing pushes the body along it.
  for (const flip of [false, true]) {
    const seen = contacts(wall(0, flip), [-0.2, 0, 0.4]);
    assert.ok(seen.length > 0);
    for (const { normal, depth } of seen) {
      near(normal, [-1, 0, 0], 'normal', 1e-12);
      assert.ok(Math.abs(depth - 0.05) < 1e-12, `depth ${depth}`);
    }
  }
});

/** Two triangles in the plane x = 0 sharing the upright seam z = 0, y from 1 to 2; the second
 *  turned by `turn` about the seam, away from a body on the -x side. */
function fold(turn: number) {
  const [p, q] = [
    [0, 1, 0],
    [0, 2, 0],
  ];
  return [...p, ...q, 0, 1.5, -3, ...q, ...p, 3 * Math.sin(turn), 1.5, 3 * Math.cos(turn)];
}

test('a fold steeper than 5° is a crease, met along the slant from its line', () => {
  // Beside the seam, on the side of the turned half: folded 30°, the seam is an edge of the
  // surface and the way out leaves its line; folded 2°, it is still one flat surface.
  const slant = (turn: number) =>
    Math.max(...contacts(fold(turn), [-0.2, 0, 0.05]).map(({ normal }) => Math.abs(normal[2])));
  assert.ok(slant(Math.PI / 6) > 0.2, `${slant(Math.PI / 6)}`);
  assert.ok(slant(Math.PI / 90) < Math.sin(Math.PI / 90) + 1e-9, `${slant(Math.PI / 90)}`);
});

test("a box's corner is a crease: a body against it leaves it diagonally", () => {
  const world = meshCollision([block(0, 0, 0, 1, 2, 1)]);
  const capsule = { feet: new Float64Array([-0.1, 0, -0.1]), radius: 0.25, height: 1.75 };
  const seen: number[][] = [];
  world.resolveCapsule(capsule, (touch) => seen.push([...touch.normal]));
  assert.ok(seen.length > 0);
  for (const normal of seen) near(normal, [-Math.SQRT1_2, 0, -Math.SQRT1_2], 'normal', 1e-9);
});

test('an edge three triangles share is a crease', () => {
  // A flat wall with a fin standing on its seam: the seam is where the surface branches.
  const fin = [0, 1, -3, 0, 2, 3, -1, 1.5, 0];
  const seen = contacts([...wall(), ...fin], [-0.2, 0, 0.4]);
  assert.ok(seen.some(({ normal }) => Math.abs(normal[2]) > 1e-3 || normal[1] !== 0));
});
