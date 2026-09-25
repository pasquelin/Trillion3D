// A scene a browser proof or probe names is where it names it (#683): a scene moved to another
// root once left a proof reading a path nothing served (a 404).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileUnder } from '../../scripts/static-server.ts';
import { SCENE_ROOTS, manifestUrlOf } from '../kit/scenes/caches.ts';
import { galleryMounts } from './support/renderHarness.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BROWSER = join(ROOT, 'tests/browser');
/** A string literal, a path or a URL, that starts under a scene root. */
const SCENE_PATH = new RegExp(`['"\`]/?((?:${SCENE_ROOTS.join('|')})/[^'"\`$]+)`, 'g');

const files = readdirSync(BROWSER, { recursive: true })
  .map(String)
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
  .map((file) => ({ file, text: readFileSync(join(BROWSER, file), 'utf8') }));
const named = files.flatMap(({ file, text }) =>
  [...text.matchAll(SCENE_PATH)].map(([, path]) => ({ file, path })),
);

// A path into a cache, the URL the #683 proof read by hand, is refused: a proof names the scene
// folder and derives what it reads from it, so the path its server serves is never written twice.
test('every scene a browser file names is a scene folder, never a cache path', () => {
  assert.ok(named.length > 0, 'no browser file names a scene');
  for (const { file, path } of named)
    assert.ok(!path.includes('/cache/'), `${file}: ${path} reaches into a cache; name the scene`);
});

// The #683 proof derived nothing wrong: its own server mounted too little. A proof that opens a
// gallery scene starts its server on the gallery mounts, and those serve every scene it names.
test('a proof that opens a gallery scene serves it on the gallery mounts', () => {
  const mounts = galleryMounts(ROOT);
  const proofs = files.filter(({ text }) => /\bawait openGalleryScene\(/.test(text));
  assert.ok(proofs.length > 0, 'no proof opens a gallery scene');
  for (const { file, text } of proofs) {
    assert.match(text, /startServer\(\{ mounts: galleryMounts\(root\) \}\)/, `${file}: not served`);
    for (const { path: scene } of named.filter((entry) => entry.file === file)) {
      const url = manifestUrlOf(scene);
      const mount = mounts.find(({ prefix }) => url.startsWith(prefix));
      assert.ok(mount, `${file}: ${url} lies under no mount`);
      const served = fileUnder(mount.dir, url.slice(mount.prefix.length));
      assert.equal(served, join(ROOT, scene, 'cache/native/full/manifest.json'));
    }
  }
});

test('a folder that is no scene, or a path into its cache, has no manifest URL', () => {
  assert.throws(() => manifestUrlOf('site/content'), /no scene with a source/);
  assert.throws(() => manifestUrlOf('tests/fixtures/formats/coplanar'), /no scene/);
  assert.throws(() => manifestUrlOf('tests/fixtures/scenes/mountain-terrain/cache/native/full'));
});
