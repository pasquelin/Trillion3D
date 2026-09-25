import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { assertUntracked } from './git-paths.ts';
import { SCENE_ROOTS } from '../tests/kit/scenes/caches.ts';
import { cacheOf, COOKED_SCENES, isStale, sourceOf } from './site-caches.ts';

const root = resolve(import.meta.dirname, '..');

test('a cache is compiled again when missing, compiled otherwise, or older than its inputs', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'trillion3d-site-caches-'));
  try {
    const scene = { directory: 'scene', source: 'source' };
    const [texture, stamp] = ['source/a.png', 'cache/compiled-with.json'].map((file) =>
      join(temporary, 'scene', file),
    );
    mkdirSync(join(temporary, 'scene/source'), { recursive: true });
    mkdirSync(join(temporary, 'scene/cache'), { recursive: true });
    writeFileSync(texture, '');
    utimesSync(texture, 1, 1);
    assert.equal(isStale(scene, temporary, 0), true, 'no cache yet');
    const options = { source: 'source', simplification: 'none' };
    writeFileSync(stamp, JSON.stringify({ ...options, budget: '1' }));
    assert.equal(isStale(scene, temporary, 0), true, 'another triangle budget');
    const current = { ...options, budget: '150000', files: ['a.png'] };
    writeFileSync(stamp, JSON.stringify({ ...current, files: ['b.png'] }));
    assert.equal(isStale(scene, temporary, 0), true, 'a source file removed or renamed since');
    writeFileSync(stamp, JSON.stringify(current));
    assert.equal(isStale(scene, temporary, 0), false, 'newer than its source and its compiler');
    assert.equal(isStale(scene, temporary, Date.now() + 1e4), true, 'a compiler built since');
    utimesSync(texture, new Date(), new Date(Date.now() + 1e4));
    assert.equal(isStale(scene, temporary, 0), true, 'a source file moved since');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('every cooked scene has its source committed under a scene root, its cache untracked', () => {
  for (const scene of Object.values(COOKED_SCENES)) {
    assert.ok(existsSync(sourceOf(scene)), scene.directory);
    assert.ok(SCENE_ROOTS.some((folder) => scene.directory.startsWith(`${folder}/`)));
    assertUntracked([`${scene.directory}/${cacheOf(scene)}/native/full/manifest.json`], root);
  }
});
