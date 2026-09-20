import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mountainTerrain } from './docs/mountain-terrain/model.mjs';
const root = resolve(import.meta.dirname, '..');

test('mountain terrain is deterministic with deep relief, strata, and a river', () => {
  const first = mountainTerrain(),
    second = mountainTerrain(),
    heights = first.positions.filter((_, index) => index % 3 === 1);
  assert.deepEqual(first, second);
  assert.equal(first.indices.length / 3, 18624);
  assert.deepEqual(
    first.bands.map((band) => band.length > 0),
    [true, true, true, true],
  );
  assert.equal(first.river.length / 3, 192);
  assert.ok(Math.max(...heights) - Math.min(...heights) > 4.5);
  assert.ok(heights.some((height) => height > 2.4));
  assert.ok(heights.some((height) => height < -0.5));
});

test('published mountain cache preserves source triangles and hierarchy', async () => {
  const directory = resolve(root, 'docs/assets/gallery/offline/terrain/cache/native/full'),
    pointer = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')),
    manifest = JSON.parse(await readFile(resolve(directory, pointer.url), 'utf8'));
  assert.equal(manifest.sourceTriangles, 18624);
  assert.equal(manifest.selectedTriangles, 18624);
  assert.equal(manifest.primitives.length, 5);
  assert.equal(manifest.scenePlugin.name, 'gltf');
});
