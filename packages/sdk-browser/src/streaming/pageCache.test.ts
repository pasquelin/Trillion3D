import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageStreamerWith } from './pageStreamer.ts';
import { createPageCache, manifestTableBytes } from './pageCache.ts';
import { dagFixture, wideCamera } from '../page/selection/dag.fixture.ts';
import { kernelUrls, packed } from '../gpu/dag/selectionHelpers.fixture.ts';
import type { StreamPage } from './types.ts';
import { servedPages } from './servedPages.fixture.ts';
import { sha256Hex } from '../measurement/sha256Hex.ts';

const TRANSFER = 64;

const open = (
  pages: StreamPage[],
  cache: ReturnType<typeof createPageCache>,
  base = 'http://cache/',
) =>
  createPageStreamerWith(pages, base, {
    cache,
    workerCount: 1,
    maxTransferBytes: TRANSFER,
  });

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
  const streamer = createPageStreamerWith(pages, 'http://cache/', {
    cache,
    workerCount: 1,
    onEvict: (url) => evicted.push(url),
    maxTransferBytes: TRANSFER,
  });
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

test("the engine's tables come out of the kept cache's total, beside the manifest and the queue", async () => {
  const urls = ['a.bin', 'b.bin', 'c.bin'];
  const { pages } = await servedPages(urls);
  const cache = createPageCache(manifestTableBytes(pages) + TRANSFER + 3 * 12);
  const streamer = open(pages, cache);
  await streamer.request(urls);
  streamer.retain(['a.bin']);
  streamer.reserve(() => 20);
  assert.deepEqual([...cache.pages.keys()], ['a.bin'], 'twenty bytes reserved leave room for one');
  streamer.dispose();
});

test("a streamer's own cache leaves with it; a kept one stays, minus pages cooked again", async () => {
  const { pages } = await servedPages(['a.bin', 'b.bin']);
  const own = open(pages, undefined as never);
  await own.request(['a.bin']);
  own.dispose();
  assert.equal(own.has('a.bin'), false);
  const kept = createPageCache();
  const first = open(pages, kept);
  await first.request(['a.bin', 'b.bin']);
  first.dispose();
  const cooked = [pages[0], { ...pages[1], sha256: 'another fingerprint' }];
  const second = open(cooked, kept);
  assert.equal(second.has('a.bin'), true);
  assert.equal(second.has('b.bin'), false, 'another page under the same url is not served');
  second.dispose();
  const resized = open([{ ...pages[0], bytes: 16 }], kept);
  assert.equal(resized.has('a.bin'), false, 'nor the same fingerprint named at another size');
  resized.dispose();
  assert.throws(() => createPageCache(0), /INVALID_PAGE_CACHE_BUDGET/);
});

test('a kept page is served only as the file it was read as: its fingerprint, under any base', async () => {
  const file = async (value: number) => {
    const bytes = new Uint8Array(12).fill(value);
    return { bytes, sha256: await sha256Hex(bytes.buffer) };
  };
  const [one, two] = await Promise.all([file(1), file(2)]);
  // Two scenes, each with its own `p.bin` of 12 bytes.
  const served = new Map([
    ['http://a/p.bin', one],
    ['http://b/p.bin', two],
  ]);
  const fetched: string[] = [];
  globalThis.fetch = async (url) => (
    fetched.push(String(url)),
    new Response(served.get(String(url))!.bytes)
  );
  const kept = createPageCache();
  const read = async (base: string, { sha256 }: { sha256: string }) => {
    const streamer = open([{ url: 'p.bin', bytes: 12, sha256 }], kept, base);
    const [value] = await streamer.readBytes('p.bin');
    streamer.dispose();
    return value;
  };
  assert.equal(await read('http://a/', one), 1);
  assert.equal(await read('http://b/', two), 2, "another scene's page under the same name");
  // The second scene's folder cooked again: the same address, another file of the same size.
  served.set('http://b/p.bin', one);
  assert.equal(await read('http://b/', one), 1, 'the same address, another fingerprint');
  assert.equal(await read('http://b/', one), 1);
  // The same file under a third base: the bytes verified against its fingerprint are served.
  assert.equal(await read('http://c/', one), 1);
  assert.deepEqual(
    fetched,
    ['http://a/p.bin', 'http://b/p.bin', 'http://b/p.bin'],
    'the same file is not fetched again',
  );
});
