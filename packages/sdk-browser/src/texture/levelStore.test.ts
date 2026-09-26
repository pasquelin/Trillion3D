import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextureLevelReader, type TextureLevelRequest } from './levelReader.ts';
import { createWebgpuTileLevels } from '../webgpu/tile/levels.ts';
import { createPageCache, manifestTableBytes, type PageCache } from '../streaming/pageCache.ts';
import { createPageStreamerWith } from '../streaming/pageStreamer.ts';
import { servedPages } from '../streaming/servedPages.fixture.ts';
import { worldBudget, worldPools } from '../world/core/worldBudget.ts';
import { SHADOW_HOST_BYTES } from '../residency/memoryBudget.ts';
import { DEFAULT_PHYSICS_BUDGET } from '../../../sdk-core/src/physics/index.ts';

const MiB = 1024 * 1024;
const BASE = 'https://host/cache/full/clusters.json';
const textures = { url: '../../textures/v4/{sha}/{kind}-{level}.{format}' };
/** The block level `level` of one texture. */
const request = (level: number): TextureLevelRequest => ({
  sha256: 'b'.repeat(64),
  atlas: 1,
  level,
  format: 'bc7',
});

/** A session's levels, read by the explorer's reader through `cache`'s store under the cook
 *  `key`; `fetched` lists every level address the server was asked. */
function session(cache: PageCache, key = 'k1', side = 1024) {
  const fetched: string[] = [];
  globalThis.createImageBitmap ??= (() => Promise.reject(new Error('unused'))) as never;
  globalThis.fetch = (async (url: string | URL) => {
    fetched.push(String(url));
    return new Response(new Uint8Array(side * side));
  }) as typeof fetch;
  const read = createTextureLevelReader({ textures, key }, BASE, cache.levels)!;
  const levels = createWebgpuTileLevels({ read, onFailure: assert.fail });
  /** Asks for `level` at `frame`, and waits for what it read. */
  const ask = async (level: number, frame = 0) => {
    levels.request(request(level), frame, [side, side]);
    await levels.settled();
  };
  return { levels, fetched, ask };
}

// Behaviour (#745, #483 rule 5): a lost device's session is rebuilt from the levels the world's
// cache holds; nothing is read again. A read landing after the scene changed keeps nothing.
test('after a device loss the texture levels are rebuilt with no level read again', async () => {
  const cache = createPageCache();
  const lost = session(cache);
  await lost.ask(0);
  lost.levels.destroy();
  const reopened = session(cache);
  assert.ok(reopened.levels.get(request(0), 1) instanceof Uint8Array, 'held across the loss');
  await reopened.ask(0, 1);
  assert.deepEqual([reopened.fetched, reopened.levels.fetched], [[], 0], '0 texture refetch');
  // A read in flight while another cook opens lands for nothing.
  reopened.levels.request(request(1), 2, [1024, 1024]);
  session(cache, 'k2');
  await reopened.levels.settled();
  assert.equal(cache.levels.bytes, 0, "the first cook's levels left with it");
});

// Behaviour (#745, #483 rule 1): the levels yield to the pages a frame keeps, before the proxy
// and before any page leaves; a level that cannot fit is not read again every frame.
test('a small CPU total: no page a frame keeps is refused for a texture level, the levels yield first', async () => {
  const urls = ['http://cache/a', 'http://cache/b'];
  const proxy = 32;
  // Room for the tables, one transfer, the two pages and the proxy, not for the level beside.
  const tables = manifestTableBytes(urls.map((url) => ({ url })));
  const cache = createPageCache(tables + 64 + 24 + proxy);
  await cache.keep('proxy', proxy, async () => new ArrayBuffer(proxy));
  const { levels, ask } = session(cache, 'k1', 8);
  await ask(0);
  assert.equal(levels.bytes, 64, 'held while the pages leave it room');
  const { pages, fetched } = await servedPages(urls);
  const heard: string[] = [];
  const streamer = createPageStreamerWith(pages, 'http://cache/', {
    cache,
    maxTransferBytes: 64,
    onDiagnostic: ({ phase }) => heard.push(phase),
  });
  streamer.retain(urls);
  await streamer.request(urls);
  const { evictions, admissionBlocked } = streamer.stats();
  assert.deepEqual([urls.every(streamer.has), evictions, admissionBlocked], [true, 0, 0]);
  assert.deepEqual(
    [levels.bytes, cache.keptBytes],
    [0, proxy],
    'the levels yield, the proxy stays',
  );
  assert.deepEqual(
    [heard.includes('page-cache-levels-yielded'), heard.includes('page-cache-kept-yielded')],
    [true, false],
  );
  for (let frame = 1; frame < 4; frame++) await ask(0, frame);
  assert.deepEqual(fetched, urls, 'a level that cannot fit is not read again');
  streamer.dispose();
});

// Behaviour (#745): the levels' cap is three quarters of the pages' share of `world.budget.cpu`,
// applied at once, the least recently read leaving first.
test('the texture levels cap follows world.budget.cpu live', async () => {
  const pools = worldPools();
  const handle = worldBudget(pools, { explorer: null }, { last: null }, () => 'webgpu', {
    ...DEFAULT_PHYSICS_BUDGET,
  });
  const { levels, ask } = session(pools.pageCache);
  await ask(0);
  await ask(1);
  assert.equal(levels.bytes, 2 * MiB);
  handle.cpu = SHADOW_HOST_BYTES + 2 * MiB;
  const cap = (3 * 2 * MiB) / 4;
  assert.deepEqual([pools.pageCache.levels.budgetBytes, handle.split.textureLevels], [cap, cap]);
  assert.equal(levels.bytes, MiB, 'the level read first left');
  assert.ok(levels.get(request(1), 2), 'the one read last stays');
});
