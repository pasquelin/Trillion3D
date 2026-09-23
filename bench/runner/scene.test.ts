import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applySceneFlag,
  DEFAULT_SCENE,
  gltfUrlIn,
  REFERENCE_SCENES,
  sceneDerived,
  sceneOf,
  scenesOf,
} from './scene.ts';
import { catalogueScenes } from './assetsCatalogue.ts';
import { CAMPAGNE } from './campaign.ts';
import { parseArgs } from './options.ts';

test('the reference scenes are the public ones, the cut first and the mirror next', () => {
  assert.deepEqual(REFERENCE_SCENES, ['sponza', 'normal-tangent-mirror-test']);
  assert.equal(DEFAULT_SCENE, 'sponza');
  // Both are catalogue models: what the bench names, `assets.ts` knows how to fetch.
  for (const scene of REFERENCE_SCENES) assert.ok(catalogueScenes().includes(scene), scene);
});

test('gltfUrlIn takes the glTF from the sources when it is there', () => {
  const root = join(tmpdir(), `wg-scene-gltf-${Date.now()}`);
  mkdirSync(join(root, 'ville'), { recursive: true });
  writeFileSync(join(root, 'ville', 'ville.gltf'), '{}');
  try {
    assert.equal(gltfUrlIn(root, 'ville'), '/benchmark-assets/ville/ville.gltf');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gltfUrlIn falls back to source.gltf of the compiled cache', () => {
  const root = join(tmpdir(), `wg-scene-src-${Date.now()}`);
  const dir = join(root, 'village-derived', 'native', 'full', 'abc');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'source.gltf'), '{}');
  try {
    assert.equal(
      gltfUrlIn(root, 'village'),
      '/benchmark-assets/village-derived/native/full/abc/source.gltf',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applySceneFlag sets the derived cache on sides that do not have one', () => {
  const flags = parseArgs(['--scene', 'flight-helmet', '--avant', 'dist']);
  applySceneFlag(flags, '/assets');
  assert.equal(flags.get('cache-apres'), sceneDerived('flight-helmet', '/assets'));
  assert.equal(flags.get('cache-avant'), sceneDerived('flight-helmet', '/assets'));
});

test('scenesOf reads --scene a,b and ignores valueless flag', () => {
  assert.deepEqual(scenesOf(parseArgs(['--scene', 'a,b'])), ['a', 'b']);
  assert.equal(sceneOf('/x/flight-helmet-derived'), 'flight-helmet');
});

test('the campaign carries the Three LOD witness and the moving reference', () => {
  const noms = CAMPAGNE.map(([n]) => n);
  assert.ok(noms.includes('three-lod'));
  assert.ok(noms.includes('three-nu'));
  assert.ok(noms.includes('mobile'));
});
