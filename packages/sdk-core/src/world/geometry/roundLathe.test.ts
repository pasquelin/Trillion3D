import test from 'node:test';
import assert from 'node:assert/strict';
import { lathe, capsule } from './round.ts';
import { RECIPES } from './recipes.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('lathe spins translated profiles with slope normals and partial-arc endpoints', () => {
  const profile: [[number, number], [number, number], [number, number]] = [
    [2, -3],
    [3, 0],
    [4, 3],
  ];
  const g = lathe(profile, 4, Math.PI / 2, Math.PI),
    p = g.attributes.position,
    n = g.attributes.normal;
  const object = lathe(
    profile.map(([x, y]) => ({ x, y })),
    4,
    Math.PI / 2,
    Math.PI,
  );
  assert.deepEqual(object.attributes.position.array, p.array);
  assert.equal(p.count, 15);
  assert.equal(g.index!.count, 48);
  for (let i = 0; i < p.count; i++) {
    near(Math.hypot(p.getX(i), p.getZ(i)), [2, 3, 4][Math.floor(i / 5)]);
    near(p.getY(i), [-3, 0, 3][Math.floor(i / 5)]);
    near(n.getY(i), -1 / Math.sqrt(10));
    near(Math.hypot(n.getX(i), n.getZ(i)), 3 / Math.sqrt(10));
    near(n.getX(i) * p.getZ(i) - n.getZ(i) * p.getX(i), 0);
  }
  near(p.getX(0), 2);
  near(p.getZ(0), 0);
  near(p.getX(4), -2);
  const uv = g.attributes.uv;
  assert.deepEqual(
    [...uv.array],
    [
      0, 0, 0.25, 0, 0.5, 0, 0.75, 0, 1, 0, 0, 0.5, 0.25, 0.5, 0.5, 0.5, 0.75, 0.5, 1, 0.5, 0, 1,
      0.25, 1, 0.5, 1, 0.75, 1, 1, 1,
    ],
  );
});

test('capsule rings join two hemispheres to the declared straight cylinder', () => {
  const g = capsule(2, 6, 2, 4),
    p = g.attributes.position;
  assert.equal(p.count, 30);
  assert.equal(g.index!.count, 120);
  assert.equal(RECIPES[g.recipe!.type], capsule);
  assert.deepEqual(g.recipe!.args, [2, 6, 2, 4]);
  for (let i = 0; i < p.count; i++) {
    const centreY = p.getY(i) < 0 ? -3 : 3;
    near(Math.hypot(p.getX(i), p.getY(i) - centreY, p.getZ(i)), 2);
  }
  near(p.getY(0), -5);
  near(p.getY(10), -3);
  near(p.getY(15), 3);
  near(p.getY(25), 5);
});

test('lathe angular UV direction and capsule lower hemisphere keep their declared seam', () => {
  const g = lathe(
    [
      [2, -1],
      [2, 1],
    ],
    4,
    0,
    Math.PI,
  );
  assert.ok(g.attributes.position.getX(1) > 1);
  assert.ok(g.attributes.position.getZ(1) > 1);
  const cap = capsule(2, 6, 4, 8);
  const p = cap.attributes.position;
  // The first longitude starts on positive Z, including the lower cap's rings.
  assert.ok(p.getZ(9) > 0);
  assert.ok(p.getY(9) > -5 && p.getY(9) < -3);
});
