import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geometryRecipes } from '../../docs/js/gallery/offline/recipes.js';
import { box } from '../../docs/js/gallery/offline/mesh.js';
import { extrude, polygon, subdivide } from '../../docs/js/gallery/offline/operations.js';
import { rationalPatch, terrain } from '../../docs/js/gallery/offline/surfaces.js';
for (const recipe of geometryRecipes)
  test(`${recipe.id} produces finite deterministic triangles`, () => {
    const a = recipe.create(),
      b = recipe.create();
    assert.deepEqual(a, b);
    assert.equal(a.positions.length % 3, 0);
    assert.equal(a.indices.length % 3, 0);
    assert.ok(a.positions.every(Number.isFinite));
    assert.ok(a.indices.every((i) => Number.isInteger(i) && i >= 0 && i < a.positions.length / 3));
  });
const volume = ({ positions: p, indices: t }) => {
  let sum = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = t.slice(i, i + 3).map((j) => p.slice(j * 3, j * 3 + 3));
    sum +=
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return sum / 6;
};
test('box orientation and midpoint refinement preserve signed volume', () => {
  const cube = box();
  assert.equal(volume(cube), 1);
  const refined = subdivide(cube);
  assert.equal(refined.indices.length, cube.indices.length * 4);
  assert.equal(volume(refined), 1);
});
test('convex extrusion volume equals analytical polygon area times depth', () => {
  assert.ok(
    Math.abs(volume(extrude(polygon(7), 1.2)) - (7 / 2) * Math.sin((2 * Math.PI) / 7) * 1.2) <
      1e-12,
  );
});
test('rational patch weight changes its center without moving corners', () => {
  const a = rationalPatch(1).positions,
    b = rationalPatch(4).positions;
  assert.deepEqual(a.slice(0, 3), b.slice(0, 3));
  assert.ok(b[(12 * 25 + 12) * 3 + 1] > a[(12 * 25 + 12) * 3 + 1]);
});
test('wide geometry requires a 32-bit index accessor', () => {
  const g = terrain(256);
  assert.ok(g.indices.some((i) => i > 65535));
});

test('vertical ray hit matches a flat surface and rejects an outside point', async () => {
  const { verticalHit } = await import('../../docs/js/gallery/offline/implicit.js');
  const flat = terrain(4, 0);
  assert.equal(verticalHit(flat, 0.3, -0.5), 0);
  assert.equal(verticalHit(flat, 10, 0), null);
});
test('authored optional attributes cover every exported vertex', async () => {
  const { paintedTerrain, splitEdges, uvTiles } =
    await import('../../docs/js/gallery/offline/attributes.js');
  for (const [g, key, width] of [
    [paintedTerrain(), 'colors', 4],
    [splitEdges(box()), 'normals', 3],
    [uvTiles(), 'uv', 2],
  ]) {
    assert.equal(g[key].length, (g.positions.length / 3) * width);
    assert.ok(g[key].every(Number.isFinite));
  }
});
test('every published cache preserves the authored triangle count', async () => {
  const { readFile } = await import('node:fs/promises');
  const { offlineExamples } = await import('../../docs/js/gallery/offline/catalog.js');
  for (const [index, example] of offlineExamples.entries()) {
    if (example.id === 'offline-terrain' || example.id === 'offline-city') continue;
    const url = new URL(`../../docs/${example.asset}`, import.meta.url);
    const pointer = JSON.parse(await readFile(url, 'utf8'));
    const manifest = JSON.parse(await readFile(new URL(pointer.url, url), 'utf8'));
    assert.equal(manifest.sourceTriangles, geometryRecipes[index].create().indices.length / 3);
    assert.equal(manifest.selectedTriangles, manifest.sourceTriangles);
    assert.equal(example.coverage, 'offline-analogue');
  }
});
