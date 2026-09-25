// The pages AHEAD of the camera (#488) go through the one residency queue, below the camera's own:
// served after every visible page, never pinned, never evicting one, and dropped once the camera
// stops, so the stopped view drains to full detail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { createWebgpuResidencyQueue } from './queue.ts';
import { createLowerTier } from './lowerTier.ts';
import { lruCache, pageOf, tierEnsurer } from './residentEnsurer.fixture.ts';
import type { PageRec } from '../../page/selection/selection.ts';

function banc(slots: number, visible: string[], ahead: string[]) {
  const camera = visible.map(pageOf),
    next = ahead.map(pageOf),
    pages = [...camera, ...next];
  const tracking = createWebgpuPageTracking(pages);
  const cache = lruCache(slots),
    load = cache.load,
    order: string[] = [];
  cache.load = async (url: string) => (order.push(url), load(url));
  const tier = createLowerTier({
    keyOf: tracking.keyOf,
    room: () => slots,
    closeOver: (ids, visit) => Array.from(ids).forEach((id) => visit(id, pages[id])),
  });
  const want = (list: PageRec[]) => {
    for (const page of list) tracking.wanted.add(tracking.keyOf(page), page);
  };
  const ensure = tierEnsurer(
    tracking,
    cache,
    () => [],
    () => tier.pages,
  );
  // Readback ids: the camera's pages first, then the ones ahead (`../cut/adoption.ts`).
  const offerAhead = (count: number) =>
    tier.offerIds(next.slice(0, count).map((_, i) => camera.length + i));
  return { camera, next, tracking, cache, order, want, ensure, offerAhead };
}

test('every visible page is admitted before any page ahead, which never evicts one', async () => {
  const b = banc(4, ['v0', 'v1', 'v2', 'v3'], ['a0', 'a1', 'a2']);
  const [v0, v1, v2, v3] = b.camera;
  b.offerAhead(3);
  b.want([v0, v1, v2]);
  await b.ensure([v0, v1, v2], 1, 1);
  assert.deepEqual(b.order, ['v0', 'v1', 'v2', 'a0'], 'the camera first, then what it leaves');
  assert.deepEqual([...b.cache.pins].sort(), ['v0', 'v1', 'v2'], 'nothing ahead is pinned');
  // A camera page evicts a page ahead, never the reverse.
  b.want([v3]);
  await b.ensure(b.camera, 2, 2);
  assert.ok(b.cache.resident.has('v3') && !b.cache.resident.has('a0'));
});

test('after a stop, the pending set drains to full detail', async () => {
  // The pool holds one camera page and every page ahead: the stopped view must take a slot back.
  const b = banc(7, ['v0', 'v1'], ['a0', 'a1', 'a2', 'a3', 'a4', 'a5']);
  const queue = createWebgpuResidencyQueue({
    tracking: b.tracking,
    sets: { applyBudget() {} } as never,
    room: () => 7,
    getCache: () => b.cache as never,
    getFrame: () => 0,
    updatePins() {},
    ensureResident: b.ensure,
    markLost() {},
    traceEnabled: false,
    traceDiagnostic: () => {},
    diagnosticFailure: () => {},
  });
  // Moving: one page on screen, six ahead, all admitted.
  b.offerAhead(6);
  b.want(b.camera.slice(0, 1));
  queue.queueCutResidency(false);
  await queue.pending;
  assert.equal(b.cache.resident.size, 7);
  // Stopped: the readback asks for nothing ahead, and the full-detail cut for both pages.
  const moving = b.order.length;
  b.offerAhead(0);
  b.want(b.camera);
  queue.queueCutResidency(false);
  await queue.pending;
  assert.equal(queue.busy, false, 'nothing left queued');
  for (const page of b.camera) assert.ok(b.cache.pins.has(page.url), `${page.url} resident`);
  assert.deepEqual(b.order.slice(moving), ['v1'], 'and nothing ahead is asked for any more');
});
