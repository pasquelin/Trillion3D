import test from 'node:test';
import assert from 'node:assert/strict';
import { lightCutCapacity, type LightCutShape } from './lightCutCapacity.ts';
import { DAG_MAX_VIEWS } from './shader/viewsWgsl.ts';

/** WebGPU's default limits: what every adapter grants without asking. */
const defaults = {
  maxComputeWorkgroupsPerDimension: 65_535,
  maxStorageBufferBindingSize: 128 << 20,
  maxBufferSize: 256 << 20,
};
const shape = (worldCount: number): LightCutShape => ({
  worldCount,
  nodeCount: worldCount * 2,
  pageCount: worldCount,
  blockCount: Math.ceil(worldCount / 64),
  levelSizes: [worldCount, worldCount],
});

// A small scene runs every view a frame may draw; a scene of many roots runs fewer, bounded by
// the dispatch that counts one thread per root per view and by the per-view frames binding.
test('a light cut runs as many views as the device limits hold, and at least one', () => {
  assert.equal(lightCutCapacity(defaults, shape(1_000)), DAG_MAX_VIEWS);
  const dispatch = lightCutCapacity(
    { ...defaults, maxStorageBufferBindingSize: 2 ** 31, maxBufferSize: 2 ** 31 },
    shape(180_000),
  );
  assert.equal(dispatch, Math.floor((65_535 * 64) / 180_000), 'bounded by the workgroups');
  const binding = lightCutCapacity(defaults, shape(60_000));
  assert.equal(binding, Math.floor((128 << 20) / (60_000 * 112)), 'bounded by the frames binding');
  assert.equal(lightCutCapacity(defaults, shape(5_000_000)), 1, "the camera's own footprint");
});
