// #836: the GPU cut pins what it admitted and nothing else, and its image reaches neither the CPU
// ranking's budget nor the CPU cut's pin step (`pinUpdater.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuResidencyQueue } from './queue.ts';
import { createRequestPins } from './requestPins.ts';
import { lruCache, pageOf } from './residentEnsurer.fixture.ts';
import { world } from './sets.fixture.ts';

test('the GPU cut pins what the image holds: a page it lets go is unpinned at once, the cover never', () => {
  const pages = ['c', 'x0', 'x1', 'x2', 'd', 'e'].map(pageOf);
  const w = world(pages.slice(1), [pages[0]]);
  const cache = lruCache(8);
  for (const page of pages) void cache.load(page.url);
  // What the CPU cut's step left pinned: the cover, and a page it no longer holds.
  for (const url of ['c', 'e']) {
    cache.pin(url);
    w.tracking.markPinned(w.tracking.pageCatalogIds.get(url)!);
  }
  const drops: string[] = [];
  const pins = createRequestPins({
    tracking: w.tracking,
    sets: w.sets,
    deferredDrops: new Set(['d', 'e']),
    byUrl: new Map([
      ['d', [pages[4]]],
      ['e', [pages[5]]],
    ]),
  });
  const id = (url: string) => w.packed.findIndex((page) => page.url === url);
  const admit = (urls: string[]) =>
    w.sets.admit(
      Int32Array.from(urls, (url) => w.tracking.keyOf(w.packed[id(url)])),
      urls.map((url) => w.packed[id(url)]),
      urls.length,
    );
  /** The image draws `urls`: what the cut rule needs to keep them drawn is held beside the queue. */
  const draw = (urls: string[]) => {
    w.delta.apply(urls.map(id));
    w.sets.applyDrawn(w.delta);
  };
  const pinned = () => [...cache.pins].sort();
  w.sets.decideBy(false);
  admit(['x0', 'x1']);
  draw(['d']);
  pins(cache as never, true, (url) => drops.push(url));
  assert.deepEqual(pinned(), ['c', 'd', 'x0', 'x1'], 'taking over: the queue, the drawn, the cover');
  assert.deepEqual(drops, ['e'], 'a deferred drop the image no longer holds goes');
  admit(['x1', 'x2']);
  pins(cache as never, false, () => {});
  assert.deepEqual(pinned(), ['c', 'd', 'x1', 'x2'], 'x0 left the queue: unpinned at once');
  draw([]);
  pins(cache as never, false, () => {});
  assert.deepEqual(pinned(), ['c', 'x1', 'x2'], 'd no longer drawn: unpinned');
  assert.equal(w.sets.heldOutsideQueue, 0, 'nothing held beside the queue and the cover');
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
