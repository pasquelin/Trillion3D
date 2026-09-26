import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadClusterManifest } from '../scene/manifestLoad.ts';
import { checked, optionalFile } from './pages.ts';
import { answering, refusedWith, type Answer } from './answers.fixture.ts';

/** The example cache that drew nothing in the browser: its own files, served from the site. */
const site = resolve(import.meta.dirname, '../../../../site');
const MANIFEST =
  'http://localhost/assets/examples/detail-by-pixel-error/cache/native/full/manifest.json';
const LIGHTS = 'https://cache.test/model/lights.json';

/** A site file, as the server sends it. */
const siteFile = (url: string) =>
  new Response(readFileSync(site + new URL(url).pathname), {
    headers: { 'Content-Type': 'application/json' },
  });

/** Serves the site's files, the cache's metadata (`clusters.json`) answering `answers`; the
 *  requests of the metadata. */
function serve(t: TestContext, answers: Answer[]) {
  // The pointer's target is resolved against the page, as a browser does it.
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: MANIFEST } });
  t.after(() => Reflect.deleteProperty(globalThis, 'location'));
  return answering(t, 'clusters.json', answers, siteFile, siteFile);
}

test('a cache resource the server refuses once (503) is asked again and the cache opens', async (t) => {
  const asked = serve(t, [503, 200]);
  const { metadata } = await loadClusterManifest(MANIFEST, 'full');
  assert.equal(metadata.sourceTriangles, 819612);
  assert.equal(asked.length, 2);
});

test('a resource still failing after its second request is refused by its address', async (t) => {
  let asked = serve(t, [503]);
  const loaded = () => loadClusterManifest(MANIFEST, 'full');
  await assert.rejects(loaded(), refusedWith(503, 'clusters.json'));
  assert.equal(asked.length, 2);
  t.mock.restoreAll();
  serve(t, ['network']);
  await assert.rejects(loaded(), refusedWith(null, 'clusters.json'));
  // A refusal a second request would meet again is not asked twice.
  for (const status of [404, 403]) {
    t.mock.restoreAll();
    asked = serve(t, [status]);
    await assert.rejects(loaded(), refusedWith(status, 'clusters.json'));
    assert.equal(asked.length, 1);
  }
});

test('an optional file the server lacks (404) or hides (403) answers null, asked once', async (t) => {
  for (const status of [404, 403]) {
    t.mock.restoreAll();
    const asked = answering(t, 'lights.json', [status]);
    assert.equal(await optionalFile(LIGHTS), null);
    assert.equal(asked.length, 1);
  }
});

test('an optional file refused otherwise (401) is refused by its address, asked once', async (t) => {
  const asked = answering(t, 'lights.json', [401]);
  const read = optionalFile(LIGHTS);
  await assert.rejects(read, refusedWith(401, 'lights.json'));
  assert.equal(asked.length, 1);
});

test('an aborted read rejects with the reason and is not asked again', async (t) => {
  const asked = answering(t, 'lights.json', ['hang']);
  const abort = new AbortController();
  const read = checked(LIGHTS, abort.signal);
  abort.abort(new Error('left'));
  await assert.rejects(read, /left/);
  assert.equal(asked.length, 1);
});
