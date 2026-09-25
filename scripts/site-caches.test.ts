import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { gitPathsSync, ignoredPaths } from './git-paths.ts';
import { COOKED_SCENES, isStale } from './site-caches.ts';

const root = resolve(import.meta.dirname, '..');
const scenes = Object.values(COOKED_SCENES);

test('a cache is compiled again when it is missing or older than a file of its source', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'trillion3d-site-caches-'));
  try {
    const scene = { directory: 'scene', source: 'source' };
    const manifest = join(temporary, 'scene/cache/native/full/manifest.json');
    mkdirSync(join(temporary, 'scene/source/textures'), { recursive: true });
    writeFileSync(join(temporary, 'scene/source/textures/a.png'), '');
    assert.equal(isStale(scene, temporary), true, 'no cache yet');
    mkdirSync(join(manifest, '..'), { recursive: true });
    writeFileSync(manifest, '{}');
    utimesSync(join(temporary, 'scene/source/textures/a.png'), 1, 1);
    assert.equal(isStale(scene, temporary), false, 'newer than its source');
    utimesSync(
      join(temporary, 'scene/source/textures/a.png'),
      new Date(),
      new Date(Date.now() + 1e4),
    );
    assert.equal(isStale(scene, temporary), true, 'a source file moved since');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('every cooked scene has its source committed, and git never tracks its cache', () => {
  for (const { directory } of scenes) {
    assert.ok(existsSync(resolve(root, directory, 'source')), directory);
    const cache = `${directory}/cache/native/full/manifest.json`;
    assert.deepEqual(gitPathsSync(['ls-files', '-z', '--', `${directory}/cache`], root), []);
    assert.deepEqual(ignoredPaths([cache], root), [cache]);
  }
});

test('the site serves no scene only the tests read, and no tracked report campaign', () => {
  const moved = ['site/assets/kinetic-garden', 'site/assets/gallery/offline', 'site/reports/*/'];
  assert.deepEqual(gitPathsSync(['ls-files', '-z', '--', ...moved], root), []);
  const index = 'site/reports/index.json';
  assert.deepEqual(ignoredPaths([index], root), [index]);
});
