import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from '../../page/selection/selection.ts';
import { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { createWebgpuResidentEnsurer } from './residentEnsurer.ts';
import { ensurerOptions, lruCache, pageOf } from './residentEnsurer.fixture.ts';
import { run, world } from './admissionReads.fixture.ts';
import { readGeometryAhead } from '../row/pageSlots.ts';
import { createPageStreamer } from '../../streaming/pageStreamer.ts';
import { servedPages } from '../../streaming/servedPages.fixture.ts';
import { PRIORITY_PREFETCH, PRIORITY_VISIBLE } from '../../streaming/priority.ts';

const state = (outcome: Awaited<ReturnType<typeof run>>) => ({
  loads: outcome.loads,
  error: String(outcome.error),
});

test('reading ahead admits the same pages in the same order as develop, on random worlds', async () => {
  let loads = 0,
    reads = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const scene = world(seed);
    const before = await run(scene, false),
      after = await run(scene, true);
    assert.deepEqual(state(after), state(before), `seed ${seed}`);
    assert.equal(before.reads.length, 0);
    // No read outlives its job: whatever no load joined is dropped when the job ends.
    assert.ok(
      after.signals.every((signal) => signal.aborted),
      `seed ${seed}`,
    );
    loads += after.loads.length;
    reads += after.reads.length;
  }
  assert.ok(loads > 400 && reads > 400, 'the random worlds load and read pages');
});

test('with room for every page, the camera reads are its loads, all issued before the first', async () => {
  for (let seed = 1; seed <= 400; seed++) {
    const scene = world(seed);
    scene.tiers = [[], []];
    const { log, loads, reads } = await run(scene, true, scene.pages.length);
    const first = log.findIndex((entry) => entry.startsWith('load'));
    assert.ok(first < 0 || log.slice(first).every((entry) => entry.startsWith('load')));
    assert.deepEqual(
      reads.map((entry) => entry.slice(5)),
      loads.map((entry) => entry.slice(5)),
      `seed ${seed}`,
    );
  }
});

test('edge cases: nothing wanted, a full pool, a parent without bytes, a page already resident', async () => {
  const [root, leaf, other] = ['root', 'leaf', 'other'].map(pageOf);
  const scene = {
    pages: [root, leaf, other],
    parentsOf: (page: PageRec) => (page === leaf ? [root] : []),
    hasBytes: (page: PageRec) => page !== root,
    slots: 3,
    resident: [other],
    camera: [] as PageRec[],
    tiers: [[], []] as PageRec[][],
  };
  assert.deepEqual((await run(scene, true)).log, [], 'an empty job reads nothing');
  scene.camera = [leaf, other];
  assert.deepEqual((await run(scene, true)).log, [], 'no read past a parent the load would miss');
  scene.hasBytes = () => true;
  const outcome = await run(scene, true);
  assert.deepEqual(outcome.reads, ['read root', 'read leaf'], 'the resident page is not read');
  assert.deepEqual(outcome.loads, ['load root', 'load leaf']);
  assert.deepEqual((await run(scene, true, 0)).reads, [], 'a pool with no slot reads nothing');
});

test('a job that throws still drops the reads it started', async () => {
  const pages = ['a', 'b'].map(pageOf);
  const tracking = createWebgpuPageTracking(pages);
  for (const page of pages) tracking.wanted.add(tracking.keyOf(page), page);
  const cache = lruCache(2),
    signals: AbortSignal[] = [];
  cache.load = async () => {
    throw new Error('WEBGPU_LOST');
  };
  const ensure = createWebgpuResidentEnsurer({
    ...ensurerOptions(tracking, cache),
    prefetch: (_page, signal) => signals.push(signal),
  });
  await assert.rejects(ensure(pages, 1, 1), /WEBGPU_LOST/);
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal.aborted));
});

test('the admission joins the read under way; the job drops what nobody joined', async () => {
  const { pages, fetched } = await servedPages(['g0.bin', 'g1.bin', 'g2.bin']);
  const streamer = createPageStreamer(pages, 'http://cache/', { workerCount: 1 });
  const geometryUrls = new Map([0, 1, 2].map((i) => [`p${i}`, `g${i}.bin`]));
  const readAhead = readGeometryAhead(geometryUrls, (url, signal) =>
    streamer.readBytes(url, signal),
  );
  const reads = new AbortController();
  for (const url of ['p0', 'p1', 'p2', 'unknown']) readAhead(pageOf(url), reads.signal);
  // The admission reads its first page: one transfer, the one already under way.
  await streamer.readBytes('g0.bin');
  // The job ends: the reads still queued that nobody joined leave the queue, never transferred.
  reads.abort();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(fetched[0], 'http://cache/g0.bin');
  assert.ok(fetched.length <= 2 && !fetched.includes('http://cache/g2.bin'), String(fetched));
  streamer.dispose();
});

test('the lower tiers read ahead at prefetch priority, the camera at its own', async () => {
  const [seen, tier] = ['seen', 'tier'].map(pageOf);
  const tracking = createWebgpuPageTracking([seen, tier]);
  tracking.wanted.add(tracking.keyOf(seen), seen);
  const asked: [string, number | undefined][] = [];
  await createWebgpuResidentEnsurer({
    ...ensurerOptions(tracking, lruCache(2)),
    lowerTiers: () => [{ pages: [tier], has: (key) => key === tracking.keyOf(tier), revision: 0 }],
    prefetch: (page, _signal, priority) => asked.push([page.url, priority]),
  })([seen], 1, 1);
  assert.deepEqual(asked, [
    ['seen', undefined],
    ['tier', PRIORITY_PREFETCH],
  ]);
});

test('a prefetch read waits behind the camera until an admission joining it raises it', async () => {
  // One worker: g0 transfers; the tier's g1 and g2 wait behind a visible g3, until g2 is demanded.
  const { pages, fetched } = await servedPages(['g0.bin', 'g1.bin', 'g2.bin', 'g3.bin']);
  const streamer = createPageStreamer(pages, 'http://cache/', { workerCount: 1 });
  const readAhead = readGeometryAhead(
    new Map([1, 2].map((i) => [`p${i}`, `g${i}.bin`])),
    streamer.readBytes,
  );
  const first = streamer.readBytes('g0.bin'),
    reads = new AbortController();
  for (const url of ['p1', 'p2']) readAhead(pageOf(url), reads.signal, PRIORITY_PREFETCH);
  await Promise.all([
    first,
    streamer.request(['g3.bin'], { priority: PRIORITY_VISIBLE }),
    streamer.readBytes('g2.bin'),
    streamer.readBytes('g1.bin', undefined, PRIORITY_PREFETCH),
  ]);
  const order = ['g0.bin', 'g2.bin', 'g3.bin', 'g1.bin'].map((url) => 'http://cache/' + url);
  assert.deepEqual(fetched, order);
  streamer.dispose();
});
