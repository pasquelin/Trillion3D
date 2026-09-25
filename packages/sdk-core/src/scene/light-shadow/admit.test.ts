// A frame's list holds every page it draws, light view by light view (#489), and the GPU draws it
// in the batches its buffers hold: so many pages, so many views, as many batches as it takes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lampPages, lampScene, planFrame, report } from './lightShadow.fixture.ts';

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
  assert.equal(admission.batchEnd(pool, 0, 24, 1), 4, 'one view a batch: its four pages');
  assert.equal(admission.batchEnd(pool, 4, 24, 1), 8, 'then the next view');
  assert.equal(admission.batchEnd(pool, 0, 3, 2), 3, 'three pages a batch');
});
