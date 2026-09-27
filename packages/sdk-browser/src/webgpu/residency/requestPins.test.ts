// #836: the GPU cut pins what it admitted and nothing else, and its image reaches neither the CPU
// ranking's budget nor the CPU cut's pin step (`pinUpdater.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuResidencyQueue } from './queue.ts';
import { createRequestPins } from './requestPins.ts';
import { lruCache, pageOf } from './residentEnsurer.fixture.ts';
import { world } from './sets.fixture.ts';

test('the GPU cut pins its queue: a page it stops admitting is unpinned at once, the cover never', () => {
  const pages = ['c', 'x0', 'x1', 'x2', 'd'].map(pageOf);
  const w = world(pages, [pages[0]]);
  const cache = lruCache(8);
  for (const page of pages) void cache.load(page.url);
  // What the CPU cut's step left pinned: the cover, and a page it drew.
  for (const url of ['c', 'd']) {
    cache.pin(url);
    w.tracking.markPinned(w.tracking.pageCatalogIds.get(url)!);
  }
  const drops: string[] = [];
  const pins = createRequestPins({
    tracking: w.tracking,
    sets: w.sets,
    bootstrapKey: w.bootstrapKey,
    deferredDrops: new Set(['d']),
    byUrl: new Map([['d', [pages[4]]]]),
  });
  const admit = (urls: string[]) => {
    const ids = urls.map((url) => pages.findIndex((page) => page.url === url));
    w.sets.admit(
      Int32Array.from(ids, (id) => w.tracking.keyOf(pages[id])),
      ids.map((id) => pages[id]),
      ids.length,
    );
  };
  w.sets.decideBy(false);
  admit(['x0', 'x1']);
  pins(cache as never, true, (url) => drops.push(url));
  assert.deepEqual(
    [...cache.pins].sort(),
    ['c', 'x0', 'x1'],
    'taking over: the queue and the cover',
  );
  assert.deepEqual(drops, ['d'], 'a deferred drop the image no longer holds goes');
  admit(['x1', 'x2']);
  pins(cache as never, false, () => {});
  assert.deepEqual(
    [...cache.pins].sort(),
    ['c', 'x1', 'x2'],
    'x0 left the queue: unpinned at once',
  );
  assert.equal(w.sets.wantedChanges.joined.count + w.sets.wantedChanges.left.count, 0, 'drained');
});

test("a GPU-cut image reaches neither the CPU cut's budget nor its pin step", async () => {
  const w = world([pageOf('x0')]);
  const calls: string[] = [];
  const refuse = (name: string) => () => {
    throw new Error(`${name} reached from a GPU-cut image`);
  };
  const queue = createWebgpuResidencyQueue({
    tracking: w.tracking,
    sets: { ...w.sets, applyBudget: refuse('applyBudget') },
    room: () => 4,
    getCache: () => undefined,
    getFrame: () => 1,
    updatePins: refuse('updatePins'),
    admitRequests: (room) => calls.push(`admit ${room}`),
    followRequestPins: () => calls.push('pins'),
    ensureResident: async () => {},
    markLost: () => {},
    traceEnabled: false,
    traceDiagnostic: () => {},
    diagnosticFailure: () => {},
  });
  queue.queueGpuCutResidency(null);
  await queue.pending;
  assert.deepEqual(calls, ['admit 4', 'pins']);
});
