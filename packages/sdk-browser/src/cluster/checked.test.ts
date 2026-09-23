import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EngineError } from '../../../sdk-core/src/index.ts';
import { loadClusterManifest } from '../scene/manifestLoad.ts';

/** The example cache that drew nothing in the browser: its own files, served from the site. */
const site = resolve(import.meta.dirname, '../../../../site');
const MANIFEST =
  'http://localhost/assets/examples/detail-by-pixel-error/cache/native/full/manifest.json';

/** Serves the site's files; the first `failures` requests of the metadata answer `failure`. */
function serve(t: TestContext, failures: number, failure: () => Response | Promise<Response>) {
  const asked: string[] = [];
  // The pointer's target is resolved against the page, as a browser does it.
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: MANIFEST } });
  t.after(() => Reflect.deleteProperty(globalThis, 'location'));
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    asked.push(url.pathname.split('/').pop()!);
    if (url.pathname.endsWith('clusters.json') && failures-- > 0) return failure();
    const body = await readFile(site + url.pathname);
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  });
  return asked;
}

test('a cache resource the server refuses once (503) is asked again and the cache opens', async (t) => {
  const asked = serve(t, 1, () => new Response('busy', { status: 503 }));
  const { metadata } = await loadClusterManifest(MANIFEST, 'full');
  assert.equal(metadata.sourceTriangles, 819612);
  assert.deepEqual(asked, ['manifest.json', 'clusters.json', 'clusters.json', 'clusters.bin']);
});

test('a resource still failing after its second request is refused by its address', async (t) => {
  const refused = (code: string) => (error: unknown) =>
    error instanceof EngineError && error.code === code && /clusters\.json/.test(error.message);
  let asked = serve(t, 2, () => new Response('busy', { status: 503 }));
  await assert.rejects(loadClusterManifest(MANIFEST, 'full'), refused('RESOURCE_HTTP_ERROR'));
  assert.equal(asked.filter((name) => name === 'clusters.json').length, 2);
  t.mock.restoreAll();
  serve(t, 2, () => Promise.reject(new TypeError('Failed to fetch')));
  await assert.rejects(loadClusterManifest(MANIFEST, 'full'), refused('RESOURCE_HTTP_ERROR'));
  // A refusal a second request would meet again is not asked twice.
  t.mock.restoreAll();
  asked = serve(t, 2, () => new Response('missing', { status: 404 }));
  await assert.rejects(loadClusterManifest(MANIFEST, 'full'), refused('RESOURCE_HTTP_ERROR'));
  assert.equal(asked.filter((name) => name === 'clusters.json').length, 1);
});
