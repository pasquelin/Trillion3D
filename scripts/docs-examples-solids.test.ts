import assert from 'node:assert/strict';
import test from 'node:test';
import { disc, lathe } from './docs/examples/mesh.ts';
import { box, heightfield, icosphere, torusKnot } from './docs/examples/solids.ts';

const vertices = (mesh: { positions: number[] }) => mesh.positions.length / 3;

test('an icosphere from sdk-core shares its vertices: 10 · 4^n + 2 of them, all on the sphere', () => {
  for (const level of [0, 2, 3]) {
    const sphere = icosphere(level);
    assert.equal(vertices(sphere), 10 * 4 ** level + 2);
    assert.equal(sphere.indices.length, 60 * 4 ** level);
    for (let v = 0; v < vertices(sphere); v++) {
      const [x, y, z] = sphere.positions.slice(v * 3, v * 3 + 3);
      assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-6);
      // Outward: the normal of a sphere's point is the point.
      const [nx, ny, nz] = sphere.normals.slice(v * 3, v * 3 + 3);
      assert.ok(x * nx + y * ny + z * nz > 0.99);
    }
  }
});

test('a rippled torus knot from sdk-core closes on itself: one vertex per ring and side', () => {
  const knot = torusKnot(
    [2, 3],
    1.5,
    0.34,
    [120, 16],
    (u, v) => 1 + 0.07 * Math.sin(v * 8 + u * 60),
  );
  assert.equal(vertices(knot), 120 * 16);
  assert.equal(knot.uvs.length, 0);
  // Its axis is y: the knot is wide in x and z, flat in y.
  const extent = (k: number) =>
    Math.max(...knot.positions.filter((_, i) => i % 3 === k).map(Math.abs));
  assert.ok(extent(1) < extent(0) && extent(1) < extent(2));
});

test('a box from sdk-core measures its (u, v) in metres along each face', () => {
  const brick = box(4, 2, 0.5, 1);
  assert.equal(vertices(brick), 24);
  assert.equal(Math.max(...brick.uvs), 4);
  assert.equal(box(4, 2, 0.5).uvs.length, 0);
});

test('a heightfield and a disc lie flat and face up; a lathe turns from +x towards -z', () => {
  const ground = heightfield(10, 4, (x) => x);
  assert.equal(vertices(ground), 25);
  assert.ok(ground.normals.every((value, i) => i % 3 !== 1 || value > 0));
  const water = disc(2, 0.5, 8);
  assert.ok(water.positions.every((value, i) => i % 3 !== 1 || Math.abs(value - 0.5) < 1e-9));
  assert.ok(water.normals.every((value, i) => Math.abs(value - (i % 3 === 1 ? 1 : 0)) < 1e-9));
  const column = lathe(
    [
      [1, 0],
      [1, 2],
    ],
    4,
    { caps: false },
  );
  assert.deepEqual(
    column.positions.slice(0, 6).map((value) => Math.round(value * 1e9) / 1e9 || 0),
    [1, 0, 0, 0, 0, -1],
  );
  assert.equal(column.uvs.length, 0);
});
