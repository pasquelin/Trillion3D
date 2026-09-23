import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { assertSourceReproduced, publishedManifest } from './docs/gallery-scene.ts';
import { mountainTerrain, terrainHeight } from './docs/mountain-terrain/model.ts';
import { writeMountainTerrain } from './docs/mountain-terrain/write.ts';
const root = resolve(import.meta.dirname, '..'),
  published = resolve(root, 'site/assets/gallery/offline/terrain');

test('mountain terrain is deterministic with deep relief, strata, and a river', () => {
  const first = mountainTerrain(),
    second = mountainTerrain(),
    heights = first.positions.filter((_, index) => index % 3 === 1);
  assert.deepEqual(first, second);
  assert.equal(first.indices.length / 3, 18592);
  assert.deepEqual(
    first.bands.map((band) => band.length > 0),
    [true, true, true, true],
  );
  assert.equal(first.river.length / 3, 160);
  const riverVertices = [...new Set(first.river)].map((index) =>
    first.positions.slice(index * 3, index * 3 + 3),
  );
  assert.ok(Math.min(...riverVertices.map(([, , z]) => z)) > -5.1);
  assert.ok(Math.max(...riverVertices.map(([, , z]) => z)) < 5.1);
  for (const [x, y, z] of riverVertices) assert.ok(Math.abs(y - terrainHeight(x, z) - 0.08) < 1e-9);
  assert.ok(Math.max(...heights) - Math.min(...heights) > 4.5);
  assert.ok(heights.some((height) => height > 2.4));
  assert.ok(heights.some((height) => height < -0.5));
  assert.ok(first.positions.every(Number.isFinite));
  assert.ok(first.indices.every((index) => index >= 0 && index < first.positions.length / 3));
});

test('published mountain source is reproduced byte for byte by its original recipe', async () => {
  await assertSourceReproduced(published, 'trillion3d-mountain-terrain-', (directory) =>
    writeMountainTerrain(directory, mountainTerrain()),
  );
});

test('published mountain cache preserves source triangles and hierarchy', async () => {
  const manifest = await publishedManifest(published);
  assert.equal(manifest.sourceTriangles, 18592);
  assert.equal(manifest.selectedTriangles, 18592);
  assert.equal(manifest.primitives.length, 5);
  assert.equal(manifest.scenePlugin.name, 'gltf');
});
