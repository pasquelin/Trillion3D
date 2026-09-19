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

test('REFERENCE_SCENES places Whisperwind next to Emerald', () => {
  assert.deepEqual(REFERENCE_SCENES, ['emerald-square', 'whisperwind-village']);
  assert.equal(DEFAULT_SCENE, 'emerald-square');
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
  const flags = parseArgs(['--scene', 'whisperwind-village', '--avant', 'dist']);
  applySceneFlag(flags, '/assets');
  assert.equal(flags.get('cache-apres'), sceneDerived('whisperwind-village', '/assets'));
  assert.equal(flags.get('cache-avant'), sceneDerived('whisperwind-village', '/assets'));
});

test('scenesOf reads --scene a,b and ignores valueless flag', () => {
  assert.deepEqual(scenesOf(parseArgs(['--scene', 'a,b'])), ['a', 'b']);
  assert.equal(sceneOf('/x/whisperwind-village-derived'), 'whisperwind-village');
});

test('the campaign carries the Three LOD witness and the moving reference', () => {
  const noms = CAMPAGNE.map(([n]) => n);
  assert.ok(noms.includes('three-lod'));
  assert.ok(noms.includes('three-nu'));
  assert.ok(noms.includes('mobile'));
});
