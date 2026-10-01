import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNormals } from './normals.ts';
import { near } from '../../math/near.fixture.ts';

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalOf = (normals: ArrayLike<number>, v: number) =>
  Array.from(normals).slice(v * 3, v * 3 + 3);

test('a face normal is unit, square to both edges, and faces the side its corners turn about', () => {
  // A slanted face whose edges have no zero coordinate, so every term of each edge counts.
  const slanted = computeNormals([1, 2, 3, 4, 1, 5, 2, 5, 4], null);
  for (let v = 0; v < 3; v++) {
    const n = normalOf(slanted, v);
    near([dot(n, [3, -1, 2]), dot(n, [1, 3, 1]), Math.hypot(...n)], [0, 0, 1], `corner ${v}`, 1e-6);
  }
  // Corners turning anticlockwise seen from +z face +z.
  near(computeNormals([0, 0, 0, 1, 0, 0, 0, 1, 0], null), [0, 0, 1, 0, 0, 1, 0, 0, 1], 'up');
});

test('a shared corner weighs each face by its area; a corner no face reaches stays zero', () => {
  const positions = [0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 1, 9, 9, 9];
  // A floor of area 2 facing +z and a wall of area ½ facing +x meet at the origin.
  const index = [1, 2, 0, 3, 4, 0];
  const shared = [0.5, 0, 2].map((c) => c / Math.hypot(0.5, 2));
  const expected = [...shared, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0];
  near(computeNormals(positions, index), expected, 'indexed', 1e-6);
  // A trailing corner pair is no face.
  near(computeNormals(positions, [...index, 1, 2]), expected, 'two corners past the faces', 1e-6);
  // A list given to write into is rewritten whole, whatever it held.
  const out = new Float64Array(18).fill(7);
  assert.equal(computeNormals(positions, index, out), out);
  near(out, expected, 'rewritten');
});
