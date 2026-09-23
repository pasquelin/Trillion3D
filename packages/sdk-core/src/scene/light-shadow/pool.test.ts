// A page keeps its static casters in the static layer once one is drawn: its moving casters alone
// changing redraws them over a copy of it, and anything else redraws the layer too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowPool, DRAW_ALL, DRAW_DYNAMIC, DRAW_FULL, STALE_DYNAMIC } from './pool.ts';
import { createShadowTable } from './table.ts';

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
