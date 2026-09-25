// A scene a browser proof or probe names is where it names it (#683): a scene moved to another
// root once left a proof reading a path nothing served (a 404).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileUnder } from '../../scripts/static-server.ts';
import { SCENE_ROOTS, hasSource, manifestUrlOf } from '../kit/scenes/caches.ts';
import { galleryMounts } from './support/renderHarness.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BROWSER = join(ROOT, 'tests/browser');
/** A string literal, a path or a URL, that starts under a scene root. */
const SCENE_PATH = new RegExp(`['"\`]/?((?:${SCENE_ROOTS.join('|')})/[^'"\`$]+)`, 'g');

const named = readdirSync(BROWSER, { recursive: true })
  .map(String)
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
  .flatMap((file) =>
    [...readFileSync(join(BROWSER, file), 'utf8').matchAll(SCENE_PATH)].map(([, path]) => ({
      file,
      path,
    })),
  );

// A path into a cache, the URL the #683 proof read by hand, is refused: a proof names the scene
// folder and derives what it reads from it, so the path its server serves is never written twice.
test('every scene a browser file names is a scene folder with its source, never a cache path', () => {
  assert.ok(named.length > 0, 'no browser file names a scene');
  for (const { file, path } of named) {
    assert.ok(!path.includes('/cache/'), `${file}: ${path} reaches into a cache; name the scene`);
    assert.ok(hasSource(path), `${file}: ${path} has no source`);
  }
});

test('the gallery mounts serve each named scene its manifest URL names', () => {
  const mounts = galleryMounts(ROOT);
  for (const { path: scene } of named) {
    const url = manifestUrlOf(scene);
    const mount = mounts.find(({ prefix }) => url.startsWith(prefix));
    assert.ok(mount, `${url} lies under no mount`);
    const served = fileUnder(mount.dir, url.slice(mount.prefix.length));
    assert.equal(served, join(ROOT, scene, 'cache/native/full/manifest.json'));
  }
});

test('a folder that is no scene has no manifest URL', () => {
  assert.throws(() => manifestUrlOf('site/content'), /no scene with a source/);
  assert.throws(() => manifestUrlOf('tests/fixtures/formats/coplanar'), /no scene/);
});
