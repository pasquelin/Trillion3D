// A frame's list holds every page it draws, light view by light view (#489), and the GPU draws it
// in the batches its buffers hold: so many pages, so many views, as many batches as it takes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowAdmission } from './admit.ts';
import { lampPages, lampScene, planFrame, report } from './lightShadow.fixture.ts';
import { createShadowPool, DRAW_ALL } from './pool.ts';
import { createShadowTable } from './table.ts';

/** Pools of these tests hold no light's floor. */
const noFloor = () => false;

test('a frame lists its pages view by view, and cuts them in batches its buffers hold', () => {
  const { store, plan, slice } = lampScene();
  plan.commit();
  // Two faces of the lamp at one mip: four pages each, two light views.
  report(plan, store, 0, [...lampPages(plan, slice, 1, 4), ...lampPages(plan, slice, 0, 4)]);
  assert.equal(planFrame(plan, store, 1), 8, 'every page read, in the frame');
  const { admission, pool } = plan;
  assert.deepEqual(
    [...admission.list.subarray(0, 8)].map((page) => pool.view[page] >> 4),
    [0, 0, 0, 0, 1, 1, 1, 1],
    'the pages of one view together',
  );
  assert.equal(admission.batchEnd(0, 24, 1), 4, 'one view a batch: its four pages');
  assert.equal(admission.batchEnd(4, 24, 1), 8, 'then the next view');
  assert.equal(admission.batchEnd(0, 3, 2), 3, 'three pages a batch');
});

// The bound of `admit.ts`: views re-marked every frame, even in views between where the list
// stopped and a pending page, never pass it.
test('a page left undrawn is drawn within a bounded number of frames, whatever is re-marked', () => {
  const pool = createShadowPool(3),
    table = createShadowTable(pool.pages),
    admission = createShadowAdmission(pool.pages);
  pool.beginAllocation(0);
  for (let entry = 0; entry < pool.pages; entry++)
    pool.view[pool.take(table, entry, 0, 0, 0)] = entry * 100;
  // One page a frame, the fewest a frame draws.
  const bound = pool.pages + 1,
    lastDrawn = new Int32Array(pool.pages).fill(-1);
  for (let frame = 0; frame < 4 * bound; frame++) {
    assert.equal(
      admission.run(pool, table, 0, frame, noFloor),
      pool.pages,
      'every page read, every frame',
    );
    const drawn = admission.list[0];
    lastDrawn[drawn] = frame;
    pool.drew(table, drawn, DRAW_ALL);
    // Re-marked at once, in a view just past the page the frame stopped at.
    pool.stale(drawn, 0, frame);
    pool.view[drawn] = pool.view[admission.list[1]] + 1;
    admission.reset(1);
    for (let page = 0; page < pool.pages; page++)
      assert.ok(frame - lastDrawn[page] <= bound, `page ${page} undrawn since ${lastDrawn[page]}`);
  }
});

/** Four pages in views 0, 1, 0, 1, each turned stale a frame later than the one before, listed
 *  once and left undrawn past the first page. */
function waitingAlternateViews() {
  const pool = createShadowPool(2),
    table = createShadowTable(pool.pages),
    admission = createShadowAdmission(pool.pages);
  pool.beginAllocation(0);
  for (let entry = 0; entry < pool.pages; entry++)
    pool.view[pool.take(table, entry, 0, 0, entry)] = entry % 2;
  admission.run(pool, table, 0, pool.pages, noFloor);
  const byView = [...admission.keys];
  admission.reset(1);
  return { pool, table, admission, byView };
}

// While nothing waits, the list is the view order alone: a view's pages that turned stale in
// different frames stay together, one light cut for them all.
test('a frame that drew its whole list lists the next by view, whatever the pages age', () => {
  const { pool, table, admission, byView } = waitingAlternateViews();
  assert.deepEqual(byView, [0, 0, 1, 1], 'one run a view');
  // Left undrawn past the first page, the pages oldest first list the next frame.
  admission.run(pool, table, 0, pool.pages + 1, noFloor);
  assert.deepEqual([...admission.list], [0, 1, 2, 3], 'the oldest first');
});

// A frame whose list is empty draws nothing and closes nothing: it is drawn whole, and the pages
// marked after it are listed by view again.
test('an empty list ends the wait: the next list is by view', () => {
  const { pool, table, admission } = waitingAlternateViews();
  // No page is read by the report of frame 1: the list is empty, and no one closes it.
  assert.equal(admission.run(pool, table, 1, pool.pages + 1, noFloor), 0, 'nothing read');
  pool.requested.fill(1);
  admission.run(pool, table, 1, pool.pages + 2, noFloor);
  assert.deepEqual([...admission.keys], [0, 0, 1, 1], 'one run a view');
});
