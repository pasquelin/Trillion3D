// A scene a browser proof or probe reads is where the proof looks for it (#683): a path under a
// scene root names a folder holding its committed source, and a URL under one is served by the
// scene mounts, which is how a scene moved to another root once went unserved (a 404).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileUnder } from '../../scripts/static-server.ts';
import { SCENE_ROOTS, sceneMounts } from '../kit/scenes/caches.ts';
import { RACINE } from './test-gpu.ts';

const BROWSER = join(RACINE, 'tests/browser');
/** A string literal, optionally a URL, that starts under a scene root. */
const SCENE_PATH = new RegExp(`['\`](/?)((?:${SCENE_ROOTS.join('|')})/[^'\`$]+)`, 'g');

const readings = readdirSync(BROWSER, { recursive: true })
  .map(String)
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
  .flatMap((file) => {
    const text = readFileSync(join(BROWSER, file), 'utf8');
    return [...text.matchAll(SCENE_PATH)].map(([, slash, path]) => ({ file, text, slash, path }));
  });

test('the moved scenes are still read by a browser proof', () => {
  const read = readings.map(({ path }) => path);
  for (const scene of [
    'tests/fixtures/scenes/kinetic-garden',
    'tests/fixtures/scenes/mountain-terrain',
  ])
    assert.ok(
      read.some((path) => path.startsWith(scene)),
      `${scene}: no proof reads it`,
    );
});

test('every scene a browser file names has its source where it names it', () => {
  for (const { file, path } of readings) {
    const scene = path.split('/cache/')[0];
    assert.ok(existsSync(join(RACINE, scene, 'source')), `${file}: ${scene} has no source`);
  }
});

test('every scene URL of a browser file is served by the scene mounts it mounts', () => {
  const mounts = sceneMounts(RACINE);
  for (const { file, text, slash, path } of readings.filter(({ slash }) => slash)) {
    const url = `${slash}${path}`;
    assert.match(text, /\bsceneMounts\(/, `${file}: ${url} is read, the scene mounts are not`);
    const mount = mounts.find(({ prefix }) => url.startsWith(prefix));
    assert.ok(mount, `${file}: ${url} lies under no scene mount`);
    assert.equal(fileUnder(mount.dir, url.slice(mount.prefix.length)), join(RACINE, path));
  }
});
