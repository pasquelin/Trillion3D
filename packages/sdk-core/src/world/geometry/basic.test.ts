import test from 'node:test';
import assert from 'node:assert/strict';
import { box, plane, circle, ring, cylinder, cone, sphere } from './basic.ts';
import type { Geometry } from './geometry.ts';
import { RECIPES } from './recipes.ts';

function verify(g: Geometry, vertices: number, triangles: number) {
  const p = g.attributes.position,
    n = g.attributes.normal,
    uv = g.attributes.uv;
  assert.equal(p.count, vertices);
  assert.equal(n.count, vertices);
  assert.equal(uv.count, vertices);
  assert.equal(g.index!.count, triangles * 3);
  for (let v = 0; v < vertices; v++) {
    assert.ok(Math.abs(Math.hypot(n.getX(v), n.getY(v), n.getZ(v)) - 1) < 1e-9);
    assert.ok(uv.getX(v) >= 0 && uv.getX(v) <= 1);
    assert.ok(uv.getY(v) >= 0 && uv.getY(v) <= 1);
  }
  for (let i = 0; i < g.index!.count; i += 3) {
    const [a, b, c] = Array.from(g.index!.array.slice(i, i + 3));
    assert.ok([a, b, c].every((v) => Number.isInteger(v) && v >= 0 && v < vertices));
    const ab = [p.getX(b) - p.getX(a), p.getY(b) - p.getY(a), p.getZ(b) - p.getZ(a)];
    const ac = [p.getX(c) - p.getX(a), p.getY(c) - p.getY(a), p.getZ(c) - p.getZ(a)];
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    assert.ok(cross[0] * n.getX(a) + cross[1] * n.getY(a) + cross[2] * n.getZ(a) >= -1e-9);
  }
}

test('box sheets cover six distinct faces with sharp outward normals and complete UV squares', () => {
  const g = box(6, 4, 2, 3, 2, 1);
  verify(g, 52, 44);
  assert.equal(RECIPES[g.recipe!.type], box);
  assert.deepEqual(g.recipe!.args, [6, 4, 2, 3, 2, 1]);
  const p = g.attributes.position,
    n = g.attributes.normal,
    uv = g.attributes.uv;
  const faces = new Set<string>();
  for (let i = 0; i < p.count; i++) {
    const point = [p.getX(i), p.getY(i), p.getZ(i)],
      normal = [n.getX(i), n.getY(i), n.getZ(i)];
    const axis = normal.findIndex((x) => x !== 0);
    faces.add(normal.join(','));
    assert.equal(Math.abs(normal[axis]), 1);
    assert.equal(point[axis], normal[axis] * [3, 2, 1][axis]);
    assert.ok(point.every((x, k) => Math.abs(x) <= [3, 2, 1][k]));
    assert.ok(point.every((x) => Number.isInteger(x)));
    assert.ok(Number.isFinite(uv.getX(i) + uv.getY(i)));
  }
  assert.equal(faces.size, 6);
  const unit = box();
  verify(unit, 24, 12);
});

test('plane subdivisions place exact thirds and middle lines with corresponding UVs', () => {
  const g = plane(6, 4, 3.8, 2.9);
  verify(g, 12, 12);
  const p = g.attributes.position,
    uv = g.attributes.uv;
  assert.deepEqual(
    [...p.array],
    [
      -3, -2, 0, -1, -2, 0, 1, -2, 0, 3, -2, 0, -3, 0, 0, -1, 0, 0, 1, 0, 0, 3, 0, 0, -3, 2, 0, -1,
      2, 0, 1, 2, 0, 3, 2, 0,
    ],
  );
  assert.deepEqual(
    [...uv.array],
    [
      0,
      0,
      1 / 3,
      0,
      2 / 3,
      0,
      1,
      0,
      0,
      0.5,
      1 / 3,
      0.5,
      2 / 3,
      0.5,
      1,
      0.5,
      0,
      1,
      1 / 3,
      1,
      2 / 3,
      1,
      1,
      1,
    ],
  );
  assert.equal(RECIPES[g.recipe!.type], plane);
  assert.deepEqual(g.recipe!.args, [6, 4, 3, 2]);
  verify(plane(), 4, 2);
  verify(plane(2, 2, -3, 0), 4, 2);
});

test('disc fans and annular strips preserve hole, radius, winding and texture placement', () => {
  const disc = circle(2, 4);
  verify(disc, 6, 4);
  assert.deepEqual(
    [...disc.attributes.position.array],
    [0, 0, 0, 2, 0, 0, 0, 2, 0, -2, 0, 0, 0, -2, 0, 2, 0, 0],
  );
  assert.deepEqual(
    [...disc.attributes.uv.array],
    [0.5, 0.5, 1, 0.5, 0.5, 1, 0, 0.5, 0.5, 0, 1, 0.5],
  );
  assert.deepEqual([...disc.index!.array], [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]);
  const arc = circle(3, 4, Math.PI / 2, Math.PI);
  assert.ok(Math.abs(arc.attributes.position.getX(1)) < 1e-9);
  assert.equal(arc.attributes.position.getY(1), 3);
  assert.equal(arc.attributes.position.getY(5), -3);
  const annulus = ring(2, 6, 4, 2);
  verify(annulus, 15, 16);
  const p = annulus.attributes.position,
    uv = annulus.attributes.uv;
  assert.deepEqual(
    Array.from({ length: 15 }, (_, i) => Math.hypot(p.getX(i), p.getY(i))),
    [2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 6],
  );
  assert.equal(uv.getX(10), 1);
  assert.equal(uv.getY(11), 1);
});

test('cylinders and cones retain cap orientation, taper normals, rings and saved parameters', () => {
  const g = cylinder(2, 4, 6, 4, 2);
  verify(g, 27, 24);
  const p = g.attributes.position,
    n = g.attributes.normal;
  assert.deepEqual(
    Array.from({ length: 15 }, (_, i) => p.getY(i)),
    [3, 3, 3, 3, 3, 0, 0, 0, 0, 0, -3, -3, -3, -3, -3],
  );
  assert.deepEqual(
    Array.from({ length: 15 }, (_, i) => Math.hypot(p.getX(i), p.getZ(i))),
    [2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4],
  );
  for (let i = 0; i < 15; i++) assert.ok(Math.abs(n.getY(i) - 1 / Math.sqrt(10)) < 1e-9);
  for (let i = 15; i < 21; i++) assert.equal(n.getY(i), 1);
  for (let i = 21; i < 27; i++) assert.equal(n.getY(i), -1);
  assert.equal(RECIPES[g.recipe!.type], cylinder);
  assert.deepEqual(g.recipe!.args, [2, 4, 6, 4, 2, false]);
  verify(cylinder(2, 4, 6, 4, 2, true), 15, 16);
  const c = cone(3, 8, 4, 2);
  verify(c, 21, 20);
  assert.equal(RECIPES[c.recipe!.type], cone);
  assert.deepEqual(c.recipe!.args, [3, 8, 4, 2, false]);
  verify(cone(3, 8, 4, 2, true), 15, 16);
});

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
  assert.equal(RECIPES[sphere().recipe!.type], sphere);
  assert.equal(RECIPES[circle(2, 4, 1, 2).recipe!.type], circle);
  assert.deepEqual(circle(2, 4, 1, 2).recipe!.args, [2, 4, 1, 2]);
  assert.equal(RECIPES[ring().recipe!.type], ring);
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
