// A page keeps its static casters in the static layer once one is drawn: its moving casters alone
// changing redraws them over a copy of it, and anything else redraws the layer too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowPool, DRAW_ALL, DRAW_DYNAMIC, DRAW_FULL, STALE_DYNAMIC } from './pool.ts';
import { createShadowTable } from './table.ts';
import { createShadowPlan } from './plan.ts';
import { createSceneLightStore } from '../light/store.ts';
import { PAGE_MAPPED } from './virtual.ts';
import { SUN, VIEW, lampPages, planFrame, report, sunPages } from './lightShadow.fixture.ts';

function mapped() {
  const table = createShadowTable(1024),
    pool = createShadowPool(32);
  pool.beginAllocation(0);
  const page = pool.take(table, 7, 0, 0, 0);
  return { table, pool, page };
}

test('without a static layer a page draws everything; with one, first in full, then moving only', () => {
  const { table, pool, page } = mapped();
  assert.equal(pool.drawMode(page, false), DRAW_ALL);
  assert.equal(pool.drawMode(page, true), DRAW_FULL, 'a new page has no layer yet');
  pool.drew(table, page, DRAW_FULL);
  pool.stale(page, 0, 1, STALE_DYNAMIC);
  assert.equal(pool.drawMode(page, true), DRAW_DYNAMIC, 'its moving casters alone changed');
  pool.drew(table, page, DRAW_DYNAMIC);
  assert.equal(pool.layered[page], 1, 'the layer still holds');
  pool.stale(page, 0, 2);
  assert.equal(pool.drawMode(page, true), DRAW_FULL, 'a full stale redraws the layer');
});

test('a full stale is never lowered by a moving one, and a page drawn whole has no layer', () => {
  const { table, pool, page } = mapped();
  pool.drew(table, page, DRAW_ALL);
  assert.equal(pool.layered[page], 0);
  assert.equal(pool.stale(page, 0, 1), true);
  assert.equal(pool.stale(page, 0, 1, STALE_DYNAMIC), false, 'already stale: no second count');
  assert.equal(pool.drawMode(page, true), DRAW_FULL);
  pool.drew(table, page, DRAW_FULL);
  pool.stale(page, 0, 2, STALE_DYNAMIC);
  assert.equal(pool.drawMode(page, true), DRAW_DYNAMIC);
});

test('an entry mapped again after the pool evicted it counts as refetched, once', () => {
  const table = createShadowTable(1),
    pool = createShadowPool(1);
  const take = (entry: number, report: number) => {
    pool.beginAllocation(report);
    return pool.take(table, entry, report, 0, report);
  };
  take(7, 0);
  take(9, 1);
  assert.equal(pool.refetched, 0, 'a first mapping is no refetch');
  take(7, 2);
  assert.equal(pool.refetched, 1, 'entry 7 comes back after its eviction');
  take(11, 3);
  take(12, 4);
  assert.equal(pool.refetched, 1, 'entries never mapped before are not refetches');
});

test('a lamp mip and a sun level are ranked within their own light before they compete', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(2);
  const view = { ...VIEW, pixelNear: 1 };
  store.add(SUN);
  store.add({ ...SUN, id: 'lamp', kind: 'point', position: [0, 3, 0], range: 20 });
  planFrame(plan, store, 0, view);
  const sun = store.sliceOf(0),
    lamp = store.sliceOf(1);
  // Six levels above the sun's finest is under half its clipmap; mip 4 is four fifths of the
  // lamp's. Four pages: the two floors, then the two lamp pages before the sun's.
  const level = plan.sun.finest[sun] + 6;
  assert.ok(level > 4, 'the level counts more steps than the mip');
  const [sunPage] = sunPages(plan, sun, level, [[0, 0]]),
    lampPage = lampPages(plan, lamp, 0, 4).slice(0, 2);
  report(plan, store, 0, [sunPage, ...lampPage]);
  planFrame(plan, store, 1, view);
  assert.ok(
    lampPage.every((entry) => plan.table.words[entry] & PAGE_MAPPED),
    'the pages go to the coarser of the two',
  );
  assert.equal(plan.table.words[sunPage] & PAGE_MAPPED, 0);
});
