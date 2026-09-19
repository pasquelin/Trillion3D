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
} from './scene.mjs';
import { CAMPAGNE } from './campagne.mjs';
import { parseArgs } from './options.mjs';

test('REFERENCE_SCENES pose Whisperwind à côté d’Emerald', () => {
  assert.deepEqual(REFERENCE_SCENES, ['emerald-square', 'whisperwind-village']);
  assert.equal(DEFAULT_SCENE, 'emerald-square');
});

test('gltfUrlIn prend le glTF des sources s’il est là', () => {
  const root = join(tmpdir(), `wg-scene-gltf-${Date.now()}`);
  mkdirSync(join(root, 'ville'), { recursive: true });
  writeFileSync(join(root, 'ville', 'ville.gltf'), '{}');
  try {
    assert.equal(gltfUrlIn(root, 'ville'), '/benchmark-assets/ville/ville.gltf');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gltfUrlIn retombe sur source.gltf du cache compilé', () => {
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

test('applySceneFlag pose le cache derived sur les côtés sans le leur', () => {
  const flags = parseArgs(['--scene', 'whisperwind-village', '--avant', 'dist']);
  applySceneFlag(flags, '/assets');
  assert.equal(flags.get('cache-apres'), sceneDerived('whisperwind-village', '/assets'));
  assert.equal(flags.get('cache-avant'), sceneDerived('whisperwind-village', '/assets'));
});

test('scenesOf lit --scene a,b et ignore le drapeau sans valeur', () => {
  assert.deepEqual(scenesOf(parseArgs(['--scene', 'a,b'])), ['a', 'b']);
  assert.equal(sceneOf('/x/whisperwind-village-derived'), 'whisperwind-village');
});

test('la campagne porte le témoin Three LOD et la référence mobile', () => {
  const noms = CAMPAGNE.map(([n]) => n);
  assert.ok(noms.includes('three-lod'));
  assert.ok(noms.includes('three-nu'));
  assert.ok(noms.includes('mobile'));
});
