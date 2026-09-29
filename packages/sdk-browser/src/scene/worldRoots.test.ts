// #1237: the runtime reads the world roots and pins their top alone; a placed cell holds the
// bundles past it that its objects' roots depend on, and lets them go when it leaves.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EngineError, type ClusterManifest } from '../../../sdk-core/src/index.ts';
import { worldRootsFixture } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts';
import { openWorldRoots } from './worldRoots.ts';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The fixture's world served over HTTP ranges, `bin` its binary as the server holds it; returns
 *  the manifest that declares its table, and the ranges asked. */
function served(t: TestContext, bin?: Uint8Array, ignoresRange = false) {
  const world = worldRootsFixture(sha);
  const json = new TextEncoder().encode(JSON.stringify(world.table));
  const held = bin ?? world.bin,
    ranges: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    if (input.endsWith('.json'))
      return new Response(json, { headers: { 'content-type': 'application/json' } });
    const range = (init?.headers as Record<string, string>).Range;
    ranges.push(range);
    if (ignoresRange) return new Response(held.slice());
    const [from, to] = range.slice('bytes='.length).split('-').map(Number);
    return new Response(held.slice(from, to + 1), { status: 206 });
  });
  const files = { 'world-roots.json': { bytes: json.byteLength, sha256: sha(json) } };
  return { ...world, ranges, manifest: { files } as unknown as ClusterManifest };
}

test('the pinned set is the world top alone; a placed cell holds its bundles past it', async (t) => {
  const { table, manifest, ranges } = served(t);
  const roots = (await openWorldRoots(manifest, 'http://world/'))!;
  const top = table.pinnedTopBytes;
  assert.deepEqual([roots.pinned.bundles, roots.pinned.bytes, roots.bytes()], [1, top, top]);
  assert.deepEqual([...roots.pinned.pages[0].positions], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(ranges, [`bytes=0-${top - 1}`], 'the top alone, in one range');
  assert.deepEqual(roots.held(), [], 'no object root and no cell bundle is pinned');
  await Promise.all([roots.hold(0), roots.hold(1), roots.hold(2)]);
  assert.deepEqual(roots.held(), [1, 2, 3], 'each bundle the placed cells need, read once');
  assert.equal(ranges.length, 4);
  roots.release(0);
  assert.deepEqual(roots.held(), [2, 3], 'a bundle another placed cell needs stays');
  roots.release(1);
  roots.release(2);
  assert.deepEqual([roots.held(), roots.bytes()], [[], top], 'the pinned top alone is left');
});

test('a bundle whose bytes are not those its table names is refused, and nothing held', async (t) => {
  const { bin } = worldRootsFixture();
  bin[bin.byteLength - 12] ^= 1; // the last bundle, a cell's
  const { manifest } = served(t, bin);
  const roots = (await openWorldRoots(manifest, 'http://world/'))!;
  await assert.rejects(
    roots.hold(0),
    (error) => error instanceof EngineError && error.code === 'INVALID_CACHE',
  );
  assert.deepEqual(roots.held(), [], 'a hold that failed holds nothing');
});

test('a server that ignores the Range is read once, whole, and every byte counted', async (t) => {
  const { manifest, ranges, bin } = served(t, undefined, true);
  const metered: string[] = [];
  const meter = {
    plan() {},
    settle() {},
    read: (response: Response, url: string) => (metered.push(url), response),
  };
  const roots = (await openWorldRoots(manifest, 'http://world/', undefined, meter))!;
  await Promise.all([roots.hold(0), roots.hold(1), roots.hold(2)]);
  assert.deepEqual(roots.held(), [1, 2, 3]);
  assert.equal(ranges.length, 1, `the whole ${bin.byteLength}-byte binary, asked once`);
  assert.deepEqual(
    metered,
    ['http://world/world-roots.json', 'http://world/world-roots.bin'],
    'the binary read is counted as it arrives, as the table is',
  );
  const bundles = roots.held().reduce((sum, at) => sum + roots.table.bundles[at].bytes, 0);
  assert.equal(
    roots.bytes(),
    roots.pinned.bytes + bundles + bin.byteLength,
    'the whole binary kept is counted in the bytes held',
  );
});

test('a cache that publishes no world roots pins nothing', async () => {
  assert.equal(await openWorldRoots({} as ClusterManifest, 'http://world/'), undefined);
});
