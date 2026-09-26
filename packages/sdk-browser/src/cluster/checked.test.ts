import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadClusterManifest } from '../scene/manifestLoad.ts';
import { checked, optionalFile, RETRY_AFTER_CAP_MS } from './pages.ts';
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

test('an abort ends a read, even in its Retry-After wait', { timeout: 1000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const busy = new Response('busy', { status: 429, headers: { 'Retry-After': '3600' } });
  for (const answer of ['hang', busy] satisfies Answer[]) {
    t.mock.restoreAll();
    const asked = answering(t, 'lights.json', [answer]);
    const abort = new AbortController();
    const read = checked(LIGHTS, abort.signal);
    await new Promise(setImmediate);
    abort.abort(new Error('left'));
    await assert.rejects(read, /left/);
    assert.equal(asked.length, 1);
  }
});

test('a timeout (408) or a rate limit (429) is asked again and answers', async (t) => {
  for (const status of [408, 429]) {
    t.mock.restoreAll();
    const asked = answering(t, 'lights.json', [status, 200]);
    assert.equal((await checked(LIGHTS)).status, 200);
    assert.equal(asked.length, 2);
  }
});

/** A refusal of `status` asking to wait `after` (`Retry-After`, seconds or an HTTP date). */
const wait = (status: number, after: string) =>
  new Response('busy', { status, headers: { 'Retry-After': after } });
/** Lets the pending reads run up to their next timer. */
const settled = () => new Promise(setImmediate);

test('a refusal asking to wait (Retry-After, seconds or a date) is asked again once waited', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const answers = [wait(429, '2'), wait(503, new Date(4000).toUTCString()), 200];
  const asked = answering(t, 'lights.json', answers);
  const read = checked(LIGHTS, undefined, 3);
  for (const count of [1, 2]) {
    await settled();
    t.mock.timers.tick(1999);
    await settled();
    assert.equal(asked.length, count, 'not before the wait is over');
    t.mock.timers.tick(1);
  }
  assert.equal((await read).status, 200);
  assert.equal(asked.length, 3);
});

test(
  'a server asking an hour (Retry-After) is waited only the cap',
  { timeout: 1000 },
  async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const asked = answering(t, 'lights.json', [wait(503, '3600'), 200]);
    const read = checked(LIGHTS);
    await settled();
    t.mock.timers.tick(RETRY_AFTER_CAP_MS - 1);
    await settled();
    assert.equal(asked.length, 1, 'not before the cap is over');
    t.mock.timers.tick(1);
    assert.equal((await read).status, 200);
    assert.equal(asked.length, 2);
  },
);
