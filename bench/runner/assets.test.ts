import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { machineBudget, selectedScenes } from './assets.ts';
import { SAMPLE_MODELS, kebab, sceneGltfFile, scenesOnDisk } from './assetsCatalogue.ts';
import { missingModels } from './assetsFetch.ts';

const sandbox = (build: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), 'trillion3d-assets-'));
  try {
    build(root);
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
};

test('a repository model name becomes the scene folder name', () => {
  assert.equal(kebab('Sponza'), 'sponza');
  assert.equal(kebab('SciFiHelmet'), 'sci-fi-helmet');
  assert.equal(kebab('ABeautifulGame'), 'abeautiful-game');
  assert.equal(kebab('NormalTangentMirrorTest'), 'normal-tangent-mirror-test');
});

test('every catalogue model says what it is kept for', () => {
  const models = Object.entries(SAMPLE_MODELS);
  assert.equal(models.length, 12);
  for (const [name, purpose] of models) {
    assert.match(name, /^[A-Za-z]+$/);
    assert.ok(purpose.length > 0, `${name} has no purpose`);
  }
});

test('a scene folder is one that holds a glTF, and a derived cache is not one', () => {
  const root = sandbox((dir) => {
    mkdirSync(join(dir, 'duck'));
    writeFileSync(join(dir, 'duck', 'Duck.gltf'), '{}');
    mkdirSync(join(dir, 'duck-derived'));
    writeFileSync(join(dir, 'duck-derived', 'Duck.gltf'), '{}');
    mkdirSync(join(dir, 'facade-7'));
    writeFileSync(join(dir, 'facade-7', 'facade.gltf'), '{}');
    mkdirSync(join(dir, 'notes'));
  });
  try {
    // Catalogue order first, then whatever else was generated there.
    assert.deepEqual(scenesOnDisk(root), ['duck', 'facade-7']);
    assert.equal(sceneGltfFile(join(root, 'notes')), null);
    assert.equal(sceneGltfFile(join(root, 'nowhere')), null);
    assert.deepEqual(missingModels(root, ['Duck', 'Sponza']), ['Sponza']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--only limits both steps, its absence takes the catalogue and the disk', () => {
  const models = ['Duck', 'Sponza'];
  assert.deepEqual(selectedScenes(undefined, ['duck', 'facade-7'], models), {
    fetch: models,
    compile: ['duck', 'facade-7'],
  });
  assert.deepEqual(selectedScenes('sponza,facade-7', ['duck'], models), {
    fetch: ['Sponza'],
    compile: ['sponza', 'facade-7'],
  });
});

test('the compile budget is read off the machine, never chosen', () => {
  assert.deepEqual(machineBudget(12, 96 * 2 ** 30), { threads: 12, ramMb: 49152 });
  // A machine that reports nothing usable still gets a job it can run.
  assert.deepEqual(machineBudget(0, 0), { threads: 1, ramMb: 1 });
});
