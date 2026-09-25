// A frame's list holds every page it draws, light view by light view (#489), and the GPU draws it
// in the batches its buffers hold: so many pages, so many views, as many batches as it takes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowAdmission } from './admit.ts';
import { lampPages, lampScene, planFrame, report } from './lightShadow.fixture.ts';
import { createShadowPool } from './pool.ts';
import { createShadowTable } from './table.ts';

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

// A frame that stops short leaves pages waiting; the views ahead of them in the order, re-marked
// every frame, even under new views that fall between where the list stopped and them, never
// pass them: a page waits at most ⌈pool pages / pages a frame draws⌉ + 1 frames.
test('a page left undrawn is drawn within a bounded number of frames, whatever is re-marked', () => {
  const pool = createShadowPool(3),
    table = createShadowTable(pool.pages),
    admission = createShadowAdmission(pool.pages);
  for (let page = 0; page < pool.pages; page++) {
    pool.owner[page] = 0;
    pool.view[page] = page * 100;
    pool.dirty[page] = 1;
    pool.requested[page] = 0;
  }
  // One page a frame, the smallest a frame draws.
  const bound = pool.pages + 1,
    lastDrawn = new Int32Array(pool.pages).fill(-1);
  for (let frame = 0; frame < 4 * bound; frame++) {
    assert.equal(admission.run(pool, table, 0), pool.pages, 'every page read, every frame');
    const drawn = admission.list[0];
    lastDrawn[drawn] = frame;
    // The drawn page is re-marked at once, in a view just past the page the frame stopped at.
    pool.view[drawn] = pool.view[admission.list[1]] + 1;
    admission.reset(1);
    for (let page = 0; page < pool.pages; page++)
      assert.ok(frame - lastDrawn[page] <= bound, `page ${page} undrawn since ${lastDrawn[page]}`);
  }
});
