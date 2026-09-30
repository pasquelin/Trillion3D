// A page keeps its static casters in the static layer once one is drawn: its moving casters alone
// changing redraws them over a copy of it, and anything else redraws the layer too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowPool, DRAW_ALL, DRAW_DYNAMIC, DRAW_FULL, STALE_DYNAMIC } from './pool.ts';
import { createShadowTable } from './table.ts';
import { createShadowPlan } from './plan.ts';
import { createSceneLightStore } from '../light/store.ts';
import { PAGE_INDEX_MASK, PAGE_MAPPED, PAGE_RANGE_SHIFT } from './virtual.ts';
import { sunPageMetres } from './pageModel.ts';
import {
  SUN,
  VIEW,
  lampPages,
  planFrame,
  report,
  sunPages,
  sunPageVolume,
  sunScene,
} from './lightShadow.fixture.ts';

function mapped() {
  const table = createShadowTable(1024),
    pool = createShadowPool(32);
  pool.beginAllocation(0);
  const page = pool.take(table, 7, 0, 0, 0);
  return { table, pool, page };
}

test('without a static layer a page draws everything; with one, first in full, then moving only', () => {
  const { table, pool, page } = mapped();
  assert.equal(pool.drawMode(page, false, 0), DRAW_ALL);
  assert.equal(pool.drawMode(page, true, 0), DRAW_FULL, 'a new page has no layer yet');
  pool.drew(table, page, DRAW_FULL, 0);
  pool.stale(page, 0, 1, STALE_DYNAMIC);
  assert.equal(pool.drawMode(page, true, 0), DRAW_DYNAMIC, 'its moving casters alone changed');
  pool.drew(table, page, DRAW_DYNAMIC, 0);
  assert.equal(pool.layered[page], 1, 'the layer still holds');
  pool.stale(page, 0, 2);
  assert.equal(pool.drawMode(page, true, 0), DRAW_FULL, 'a full stale redraws the layer');
});

test('a full stale is never lowered by a moving one, and a page drawn whole has no layer', () => {
  const { table, pool, page } = mapped();
  pool.drew(table, page, DRAW_ALL, 0);
  assert.equal(pool.layered[page], 0);
  assert.equal(pool.stale(page, 0, 1), true);
  assert.equal(pool.stale(page, 0, 1, STALE_DYNAMIC), false, 'already stale: no second count');
  assert.equal(pool.drawMode(page, true, 0), DRAW_FULL);
  pool.drew(table, page, DRAW_FULL, 0);
  pool.stale(page, 0, 2, STALE_DYNAMIC);
  assert.equal(pool.drawMode(page, true, 0), DRAW_DYNAMIC);
});

test('a layer drawn in another depth range is drawn again with the page, never restored', () => {
  const { table, pool, page } = mapped();
  pool.drew(table, page, DRAW_FULL, 3);
  assert.equal(table.words[7] >>> PAGE_RANGE_SHIFT, 3, 'the word names the range drawn in');
  pool.stale(page, 0, 1, STALE_DYNAMIC);
  assert.equal(pool.drawMode(page, true, 3), DRAW_DYNAMIC, 'the same range: the layer holds');
  assert.equal(pool.drawMode(page, true, 4), DRAW_FULL, "another range: the layer's is not it");
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

test('a page a mover covers in part is never reported valid-cached until its moving casters are redrawn', () => {
  const { store, plan, slice } = sunScene();
  const level = plan.sun.finest[slice] + 4,
    pages = sunPages(plan, slice, level, [[3, 2]]),
    { pool, admission } = plan;
  const listed = () => [...admission.list.subarray(0, admission.count)];
  // The engine's loop with a static layer: each page drawn as `drawMode` says.
  const drawn = () =>
    plan.commit(listed().map((page) => pool.drawMode(page, true, plan.records.rangeOf(page))));
  for (let frame = 1; frame < 4; frame++) {
    planFrame(plan, store, frame);
    drawn();
    report(plan, store, frame, pages);
  }
  const page = plan.table.words[pages[0]] & PAGE_INDEX_MASK,
    cached = plan.counts.cachedPages;
  assert.equal(pool.layered[page], 1, 'its static casters are in the layer');
  // A moving caster a tenth of the page wide, over the page's centre: it covers a part of it.
  const volume = sunPageVolume(plan, slice, level, 3, 2),
    half = sunPageMetres(level) / 20;
  const centre = [0, 1, 2].map((a) => volume[a]);
  plan.worldChanged(
    centre.map((c) => c - half),
    centre.map((c) => c + half),
    true,
  );
  planFrame(plan, store, 4);
  assert.equal(pool.dirty[page], STALE_DYNAMIC, 'its moving casters are stale');
  assert.ok(plan.counts.cachedPages < cached, 'not counted straight from the cache');
  assert.equal(pool.drawMode(page, true, plan.records.rangeOf(page)), DRAW_DYNAMIC);
  assert.ok(listed().includes(page), 'drawn this frame');
  drawn();
  assert.equal(pool.dirty[page], 0, 'current once its moving casters are redrawn');
  assert.equal(pool.layered[page], 1, 'over its static layer, kept');
});
