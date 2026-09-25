import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageStreamer } from './pages.ts';
import { createPageCache, manifestTableBytes } from './pageCache.ts';
import { dagFixture, wideCamera } from '../page/selection/dag.fixture.ts';
import { kernelUrls, packed } from '../gpu/dag/selectionHelpers.fixture.ts';
import type { StreamPage } from './types.ts';
import { servedPages } from './servedPages.fixture.ts';

const TRANSFER = 64;

const open = (pages: StreamPage[], cache: ReturnType<typeof createPageCache>) =>
  createPageStreamer(
    pages,
    'http://cache/',
    undefined,
    1,
    undefined,
    undefined,
    TRANSFER,
    undefined,
    cache,
  );

test('a session reopened after a device loss rebuilds the same cut, fetching nothing it held', async () => {
  const fixture = dagFixture(),
    camera = wideCamera();
  const { dag } = packed(fixture);
  const { pages, fetched } = await servedPages(dag.pageUrls);
  const cache = createPageCache(1024 * 1024);
  /** The cut drawn from what `streamer` holds: the GPU pool is filled from it. */
  const cut = (streamer: ReturnType<typeof open>) => {
    const resident = Uint32Array.from(dag.pageUrls, (url) => Number(streamer.has(url)));
    return kernelUrls(fixture, 1, camera, resident, 'drawablePageIds').urls;
  };
  // Every page of the fixture: the cut draws a group only once its members and the groups above
  // it are resident (#486), and this DAG is small enough to hold whole.
  const wanted = [...dag.pageUrls];
  const before = open(pages, cache);
  await before.request(wanted);
  const drawn = cut(before);
  assert.ok(drawn.length > 0);
  const fetchedBefore = fetched.length;
  assert.equal(fetchedBefore, wanted.length);
  // The device is lost: the session closes, and the world keeps its cache.
  before.dispose();
  assert.equal(cache.pages.size, wanted.length, 'the pages outlive the session');
  // A device granted again: the new session reads the same pages, from the cache alone.
  const after = open(pages, cache);
  await after.request(wanted);
  assert.equal(fetched.length, fetchedBefore, 'no page it held was fetched again');
  assert.equal(after.stats().hits, wanted.length);
  assert.deepEqual(cut(after), drawn);
  after.dispose();
});

test("the CPU counters — tables, transfers, pages — never exceed the cache's total", async () => {
  const urls = Array.from({ length: 64 }, (_, i) => `p${i}.bin`);
  const { pages, fetched } = await servedPages(urls);
  // Room for the tables, one transfer, and ten pages.
  const cpu = manifestTableBytes(pages) + TRANSFER + 10 * 12;
  const cache = createPageCache(cpu);
  const streamer = open(pages, cache);
  for (const url of urls) {
    await streamer.request([url]);
    const { cpuBytes, cpuBudgetBytes } = streamer.stats();
    assert.equal(cpuBudgetBytes, cpu);
    assert.ok(cpuBytes <= cpu, `${cpuBytes} > ${cpu} after ${url}`);
  }
  assert.equal(fetched.length, urls.length);
  assert.equal(cache.bytes, 10 * 12, 'the pages hold what the tables and the queue leave');
  streamer.dispose();
});

test('a lower total applies at once, pages leaving by last use, pins kept', async () => {
  const urls = ['a.bin', 'b.bin', 'c.bin', 'd.bin'];
  const { pages } = await servedPages(urls);
  const reserved = manifestTableBytes(pages) + TRANSFER;
  const cache = createPageCache(reserved + 4 * 12);
  const evicted: string[] = [];
  const streamer = createPageStreamer(
    pages,
    'http://cache/',
    undefined,
    1,
    undefined,
    (url) => evicted.push(url),
    TRANSFER,
    undefined,
    cache,
  );
  await streamer.request(urls);
  streamer.retain(['a.bin']);
  // `b` read again: the least recently used is now `c`, then `d`.
  streamer.get('b.bin');
  cache.resize(reserved + 2 * 12);
  assert.deepEqual(evicted, ['c.bin', 'd.bin']);
  assert.deepEqual([...cache.pages.keys()], ['a.bin', 'b.bin']);
  assert.ok(streamer.stats().cpuBytes <= cache.cpuBytes);
  streamer.dispose();
  // No session reads: a total set lower still applies, oldest first.
  cache.resize(reserved + 12);
  assert.deepEqual([...cache.pages.keys()], ['a.bin', 'b.bin'], 'a session gone reserves nothing');
  cache.resize(12);
  assert.deepEqual([...cache.pages.keys()], ['b.bin']);
});

test("a streamer's own cache leaves with it; a kept one stays, minus pages the catalogue resized", async () => {
  const { pages } = await servedPages(['a.bin', 'b.bin']);
  const own = open(pages, undefined as never);
  await own.request(['a.bin']);
  own.dispose();
  assert.equal(own.has('a.bin'), false);
  const kept = createPageCache();
  const first = open(pages, kept);
  await first.request(['a.bin', 'b.bin']);
  first.dispose();
  const resized = [pages[0], { ...pages[1], bytes: 16 }];
  const second = open(resized, kept);
  assert.equal(second.has('a.bin'), true);
  assert.equal(second.has('b.bin'), false, 'another page under the same url is not served');
  second.dispose();
  assert.throws(() => createPageCache(0), /INVALID_PAGE_CACHE_BUDGET/);
});
