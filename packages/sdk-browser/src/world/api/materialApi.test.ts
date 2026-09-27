// The page reads a scene's materials as detached copies and sets them live: every listed value
// lands in each surface the scene built from the entry, the engine is asked to read them again,
// and what it cannot apply to this material alone is refused by name before any write.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { followHostTexture, importHostTexture } from '../../host/textureImport.ts';
import { refusal, scene } from './materialApi.fixture.ts';

test('the scene materials are listed by table rank, each a detached copy', async () => {
  const { api, floor } = await scene();
  assert.deepEqual(
    api.materials().map(({ id, name, alphaMode }) => [id, name, alphaMode]),
    [
      ['0', 'floor', 'opaque'],
      ['1', 'leaves', 'mask'],
      ['2', 'left', 'opaque'],
      ['3', 'right', 'opaque'],
      ['4', 'glass', 'blend'],
    ],
  );
  const before = api.material('0');
  assert.deepEqual(before.tiling, [1, 1]);
  for (const read of [api.materials()[0], api.material('0'), api.importedMaterials()[0]]) {
    // A host that ignores `readonly` writes into what it read: the engine must not see it.
    Reflect.set(read.baseColor, 0, 9);
    Reflect.set(read.emissive, 1, 9);
    Reflect.set(read.tiling!, 0, 9);
    read.roughness = 0;
  }
  assert.deepEqual(api.material('0'), before);
  assert.deepEqual(api.importedMaterials()[0], before);
  assert.equal((floor[0].color as G.Color).r, 0.5);
  for (const id of ['9', '', ' 1', '1.0'])
    assert.throws(() => api.material(id), refusal('UNKNOWN_MATERIAL'));
});

test('setMaterial writes each listed value into every surface of the material, live', async () => {
  const { api, floor, textures, refreshes } = await scene();
  const versions = floor.map((surface) => surface.version);
  const record = importHostTexture(textures[0]);
  followHostTexture(record);
  const placement = record.placement;
  api.setMaterial('0', {
    baseColor: [0.25, 0.5, 0.75],
    opacity: 0.5,
    metalness: 0.75,
    roughness: 0.25,
    emissive: [2, 1, 0],
    alphaMode: 'opaque',
    tiling: [4, 2],
  });
  assert.equal(refreshes.length, 1, 'the engine reads the surfaces again');
  const read = api.material('0');
  assert.deepEqual(read.baseColor, [0.25, 0.5, 0.75]);
  assert.equal(read.opacity, 0.5);
  assert.equal(read.metalness, 0.75);
  assert.equal(read.roughness, 0.25);
  assert.deepEqual(read.emissive, [2, 1, 0]);
  assert.deepEqual(read.tiling, [4, 2]);
  assert.equal(read.alphaMode, 'opaque');
  for (const [i, surface] of floor.entries()) {
    assert.equal(surface.version, versions[i] + 1, 'every variant repainted in place');
    assert.equal((surface.color as G.Color).b, 0.75);
    assert.equal(surface.roughness, 0.25);
  }
  assert.deepEqual([textures[0].repeat.x, textures[0].repeat.y], [4, 2]);
  followHostTexture(record);
  assert.equal(record.placement, placement + 1, 'an engine following the map sees it tiled');
  assert.equal(record.transform[0], 4);
  assert.equal(api.setMaterial('1', { alphaCutoff: 0.25 }), true, 'every engine took it');
  assert.equal(api.material('1').alphaCutoff, 0.25);
  assert.equal(api.importedMaterials()[0].roughness, 1, 'the file values stay readable');
  assert.equal(api.importedMaterials()[1].alphaCutoff, 0.5);
});

test('setMaterial refuses by name what it cannot apply to this material alone', async () => {
  const { api } = await scene();
  assert.throws(() => api.setMaterial('9', { roughness: 0 }), refusal('UNKNOWN_MATERIAL'));
  assert.throws(() => api.setMaterial('0', { roughness: 2 }), refusal('INVALID_MATERIAL'));
  assert.throws(() => api.setMaterial('0', { tiling: [0, 1] }), refusal('INVALID_MATERIAL'));
  assert.throws(() => api.setMaterial('1', { tiling: [2, 2] }), refusal('INVALID_MATERIAL'));
  assert.throws(() => api.setMaterial('2', { tiling: [2, 2] }), refusal('MATERIAL_TEXTURE_SHARED'));
  const { api: fixed } = await scene(false);
  assert.throws(
    () => fixed.setMaterial('0', { roughness: 0 }),
    refusal('UNSUPPORTED_SCENE_UPDATE'),
  );
  assert.equal(fixed.material('0').roughness, 1);
});
