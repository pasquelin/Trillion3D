import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fossilExcavation } from './docs/fossil-excavation/scene.mjs';
import { writeFossilExcavation } from './docs/fossil-excavation/write.mjs';

const root = resolve(import.meta.dirname, '..'),
  published = resolve(root, 'docs/assets/gallery/fossil-excavation');

test('fossil excavation is deterministic and keeps recognizable material groups', () => {
  const first = fossilExcavation(),
    second = fossilExcavation(),
    triangles = Object.values(first).reduce((sum, part) => sum + part.faces.length, 0);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first), [
    'bone',
    'shadow',
    'sandstone',
    'ochre',
    'markerRed',
    'markerBlue',
    'paper',
    'metal',
  ]);
  assert.equal(triangles, 9_784);
  assert.ok(first.bone.faces.length >= 8_000, 'the articulated fossil carries visible detail');
  for (const geometry of Object.values(first)) {
    assert.ok(geometry.vertices.flat().every(Number.isFinite));
    assert.ok(
      geometry.faces.flat().every((index) => index > 0 && index <= geometry.vertices.length),
    );
  }
});

test('published OBJ and MTL are reproduced byte for byte by the recipe', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'wg-fossil-excavation-'));
  try {
    await writeFossilExcavation(temporary, fossilExcavation());
    for (const file of ['excavation.obj', 'excavation.mtl'])
      assert.deepEqual(
        await readFile(join(temporary, file)),
        await readFile(join(published, 'source', file)),
      );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('published cache proves the public OBJ importer and authored groups', async () => {
  const pointer = JSON.parse(
      await readFile(join(published, 'cache/native/full/manifest.json'), 'utf8'),
    ),
    manifest = JSON.parse(
      await readFile(join(published, 'cache/native/full', pointer.url), 'utf8'),
    );
  assert.equal(manifest.sourceTriangles, 9_784);
  assert.equal(manifest.selectedTriangles, 9_784);
  assert.equal(manifest.primitives.length, 8);
  assert.equal(manifest.scenePlugin.name, 'obj');
  assert.equal(manifest.simplification, false);
});
