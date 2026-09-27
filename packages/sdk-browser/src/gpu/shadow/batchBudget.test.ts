// The memory a frame's shadow batches add (#489, #483 rule 5, #831): granted for one pool layer in
// full batches, each in at most one view per page, and counted in the memory budget from that one
// rule; a frame's own batches and staging follow the current pool, the views a batch runs and the
// device's buffer limit, within the grant. Checked here against what the modules allocate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYER_PAGES } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { createLightCutRedraws } from '../dag/lightCutRedraws.ts';
import { DAG_MAX_VIEWS } from '../dag/shader/viewsWgsl.ts';
import { createCpuCasterLists } from '../../webgpu/shadow/cpuCasters.ts';
import { SHADOW_HOST_BYTES, SHADOW_POOL_BYTES } from '../../residency/memoryBudget.ts';
import { shadowBatchWrites } from './batchWrites.ts';
import { createGpuShadowCullCounts } from './cullCounts.ts';
import { MAX_SHADOW_PAGES } from './recordPack.ts';
import {
  MAX_SHADOW_BATCHES,
  MAX_SHADOW_RUNS,
  SHADOW_BATCH_GPU_BYTES,
  SHADOW_BATCH_HOST_BYTES,
  SHADOW_BATCH_WRITE_BYTES,
  SHADOW_COUNT_SAMPLERS,
  SHADOW_FLAG_FRAMES,
  SHADOW_STAGING_BYTES,
  shadowBatchCapacity,
} from './batchBudget.ts';

const MiB = 1024 * 1024;

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

test('the GPU bytes the batches add are what the staging, flags, CPU lists and counts allocate', () => {
  const { device, buffers } = fakeDevice();
  const target = device.createBuffer({ size: SHADOW_BATCH_WRITE_BYTES, usage: 0 });
  const writes = shadowBatchWrites(device);
  writes.reserve(SHADOW_STAGING_BYTES);
  writes.stage(device.createCommandEncoder());
  writes.write(target, 0, Uint32Array.of(1));
  writes.end();
  createLightCutRedraws((d) => device.createBuffer(d), target, DAG_MAX_VIEWS);
  const lists = createCpuCasterLists(device, 1);
  // The cull's and the occlusion test's count samples.
  for (let k = 0; k < SHADOW_COUNT_SAMPLERS; k++) createGpuShadowCullCounts(device);
  const made = buffers.filter(
    (buffer) => buffer !== (target as unknown) && buffer !== (lists.source as unknown),
  );
  const gpu = made.reduce((sum, { size }) => sum + size, 0);
  assert.equal(gpu, SHADOW_BATCH_GPU_BYTES);
  assert.ok(SHADOW_BATCH_GPU_BYTES < 5 * MiB, `${SHADOW_BATCH_GPU_BYTES} bytes`);
  const cpuHost = lists.bases.byteLength + lists.lengths.byteLength + lists.commands.byteLength;
  assert.equal(cpuHost, MAX_SHADOW_RUNS * 24);
  assert.ok(SHADOW_BATCH_HOST_BYTES > SHADOW_FLAG_FRAMES * MAX_SHADOW_BATCHES * MAX_SHADOW_PAGES);
});

test('the memory budget counts the batches with the shadows', () => {
  assert.ok(SHADOW_POOL_BYTES > SHADOW_BATCH_GPU_BYTES);
  assert.ok(SHADOW_HOST_BYTES > SHADOW_BATCH_HOST_BYTES);
});
