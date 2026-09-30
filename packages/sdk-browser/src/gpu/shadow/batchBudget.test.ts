// The memory a frame's shadow batches add (#489, #483 rule 5, #831): granted for one pool layer in
// full batches, each in at most one view per page; a frame's own batches and staging follow the
// current pool, the views a batch runs and the device's buffer limit, within the grant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYER_PAGES } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { DAG_MAX_VIEWS } from '../dag/shader/viewsWgsl.ts';
import { MAX_SHADOW_PAGES } from './recordPack.ts';
import {
  MAX_SHADOW_BATCHES,
  MAX_SHADOW_RUNS,
  SHADOW_BATCH_WRITE_BYTES,
  SHADOW_STAGING_BYTES,
  shadowBatchCapacity,
} from './batchBudget.ts';

test('the grant holds one pool layer in full batches, each in at most one view per page', () => {
  assert.equal(LAYER_PAGES, 4096);
  assert.equal(MAX_SHADOW_BATCHES, Math.ceil(LAYER_PAGES / MAX_SHADOW_PAGES));
  assert.equal(MAX_SHADOW_BATCHES, 171);
  assert.equal(MAX_SHADOW_RUNS, MAX_SHADOW_BATCHES * MAX_SHADOW_PAGES);
  assert.equal(DAG_MAX_VIEWS, MAX_SHADOW_PAGES, 'the host and the shaders agree on a batch');
});

// Capacities agree whatever the device: the current pool in the fewest pages a batch holds, never
// past the grant nor past the staging buffer the device can make.
test("a frame's batches follow its pool, its views and the device, within the grant", () => {
  const pool = 51 * 51,
    large = Number.MAX_SAFE_INTEGER;
  const full = shadowBatchCapacity(pool, DAG_MAX_VIEWS, large);
  assert.equal(full.batches, Math.ceil(pool / MAX_SHADOW_PAGES));
  assert.equal(full.stagingBytes, (full.batches - 1) * SHADOW_BATCH_WRITE_BYTES);
  assert.ok(full.stagingBytes < SHADOW_STAGING_BYTES, 'a smaller pool stages less');
  assert.equal(shadowBatchCapacity(pool, 1, large).batches, MAX_SHADOW_BATCHES, 'one view');
  assert.equal(shadowBatchCapacity(600, 6, large).batches, 100, 'six views: six pages a batch');
  assert.equal(shadowBatchCapacity(1, DAG_MAX_VIEWS, large).stagingBytes, 0, 'one batch');
  assert.equal(shadowBatchCapacity(64 * 64, DAG_MAX_VIEWS, large).batches, MAX_SHADOW_BATCHES);
  const small = shadowBatchCapacity(pool, DAG_MAX_VIEWS, 10 * SHADOW_BATCH_WRITE_BYTES + 3);
  assert.deepEqual(small, { batches: 11, stagingBytes: 10 * SHADOW_BATCH_WRITE_BYTES });
});
