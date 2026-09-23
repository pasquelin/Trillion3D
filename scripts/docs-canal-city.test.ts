import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { assertSourceReproduced, publishedManifest } from './docs/gallery-scene.ts';
import { canalCity } from './docs/canal-city/model.ts';
import { writeCanalCity } from './docs/canal-city/write.ts';
const root = resolve(import.meta.dirname, '..'),
  published = resolve(root, 'site/assets/gallery/offline/city');

test('canal city is deterministic, detailed, and keeps every authored material group', () => {
  const first = canalCity(),
    second = canalCity(),
    triangles = Object.values(first).reduce((sum, part) => sum + part.indices.length / 3, 0);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first), [
    'brick',
    'ochre',
    'stone',
    'slate',
    'glass',
    'water',
    'metal',
  ]);
  assert.equal(triangles, 6092);
  assert.ok(first.glass.indices.length / 3 >= 1000, 'recessed windows carry visible geometry');
  assert.ok(
    first.stone.indices.length / 3 >= 1500,
    'quays, sills, and cornices carry visible geometry',
  );
  for (const geometry of Object.values(first)) {
    assert.equal(geometry.positions.length % 3, 0);
    assert.equal(geometry.indices.length % 3, 0);
    assert.ok(geometry.positions.every(Number.isFinite));
    assert.ok(
      geometry.indices.every((index) => index >= 0 && index < geometry.positions.length / 3),
    );
  }
});

test('published canal source is reproduced byte for byte by its original recipe', async () => {
  await assertSourceReproduced(published, 'wg-canal-city-', (directory) =>
    writeCanalCity(directory, canalCity()),
  );
});

test('published canal cache preserves the seven authored primitives and triangle count', async () => {
  const manifest = await publishedManifest(published);
  assert.equal(manifest.sourceTriangles, 6092);
  assert.equal(manifest.selectedTriangles, 6092);
  assert.equal(manifest.primitives.length, 7);
  assert.equal(manifest.scenePlugin.name, 'gltf');
});
