import test from 'node:test';
import assert from 'node:assert/strict';
import { torus, torusKnot, tube, lathe, capsule } from './round.ts';
import { Path } from '../math/curves.ts';
import { Vector3 } from '../math/vector3.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('torus tube lies at the declared distance from its central circle, with outward normals', () => {
  for (const arc of [Math.PI, Math.PI * 2]) {
    const g = torus(5, 2, 4, 8, arc),
      p = g.attributes.position,
      n = g.attributes.normal,
      uv = g.attributes.uv;
    assert.equal(p.count, 45);
    assert.equal(g.index!.count, 192);
    assert.deepEqual(g.recipe, { type: 'torus', args: [5, 2, 4, 8, arc] });
    for (let i = 0; i < p.count; i++) {
      near(Math.hypot(Math.hypot(p.getX(i), p.getY(i)) - 5, p.getZ(i)), 2);
      near(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)), 1);
      near(p.getZ(i), 2 * n.getZ(i));
      const cx = p.getX(i) - 2 * n.getX(i),
        cy = p.getY(i) - 2 * n.getY(i);
      near(Math.hypot(cx, cy), 5);
      assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1 && uv.getY(i) >= 0 && uv.getY(i) <= 1);
    }
    near(p.getX(0), 7);
    near(p.getY(0), 0);
    near(p.getZ(9), 2);
    near(p.getX(8), arc === Math.PI ? -7 : 7);
    assert.equal(uv.getX(8), 1);
    assert.equal(uv.getY(36), 1);
  }
  assert.deepEqual(torus().recipe!.args, [1, 0.4, 12, 48, Math.PI * 2]);
});

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
  assert.deepEqual(g.recipe, { type: 'capsule', args: [2, 6, 2, 4] });
  for (let i = 0; i < p.count; i++) {
    const centreY = p.getY(i) < 0 ? -3 : 3;
    near(Math.hypot(p.getX(i), p.getY(i) - centreY, p.getZ(i)), 2);
  }
  near(p.getY(0), -5);
  near(p.getY(10), -3);
  near(p.getY(15), 3);
  near(p.getY(25), 5);
  assert.deepEqual(capsule().recipe!.args, [1, 1, 4, 8]);
});

test('open tubes keep translated endpoints, radius and normals across either frame seed', () => {
  for (const end of [new Vector3(8, 2, 3), new Vector3(1, 9, 3), new Vector3(5, 7, 9)]) {
    const start = new Vector3(1, 2, 3),
      path = new Path([start, end]);
    const g = tube(path, 4, 0.5, 4),
      p = g.attributes.position,
      n = g.attributes.normal;
    assert.equal(p.count, 25);
    assert.equal(g.index!.count, 96);
    for (let i = 0; i < p.count; i++) {
      const centre = path.getPoint((i % 5) / 4),
        delta = new Vector3(p.getX(i), p.getY(i), p.getZ(i)).sub(centre);
      near(delta.length(), 0.5);
      near(delta.dot(end.clone().sub(start)), 0);
      near(delta.x, 0.5 * n.getX(i));
      near(delta.y, 0.5 * n.getY(i));
      near(delta.z, 0.5 * n.getZ(i));
    }
  }
  const knot = torusKnot(2, 0.25, 8, 4, 1, 2);
  assert.deepEqual(knot.recipe, { type: 'torusKnot', args: [2, 0.25, 8, 4, 1, 2] });
  assert.equal(knot.attributes.position.count, 45);
  assert.deepEqual(torusKnot().recipe!.args, [1, 0.4, 64, 8, 2, 3]);
});
