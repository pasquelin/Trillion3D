// Synchronous triangles batch: `drawnTriangles` enters `BACKEND_METRIC_KEYS`, so `fillMetrics`
// copies it like any other engine measurement — `null` before the first frame (no cut),
// never `null` once an engine has published a cut and its drawn-triangle count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerMetrics } from './metrics.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import type { MeasuredWorldOptions, RenderBackend } from '../../backend/types.ts';
import type { createPageStreamer } from '../../streaming/pageStreamer.ts';

const streamer = {
  stats: () => ({
    evictions: 0,
    loaded: 0,
    bytesRead: 0,
    requested: 0,
    loading: 0,
    hits: 0,
    misses: 0,
  }),
} as unknown as ReturnType<typeof createPageStreamer>;
function harnais(effectBytes = 0) {
  return createExplorerMetrics(
    {} as ClusterManifest,
    {} as MeasuredWorldOptions,
    streamer,
    0,
    0,
    () => ({ loaded: 0, pageBytesRead: 0, streamingError: null, effectBytes }),
  );
}

test('drawnTriangles is null before any sampled frame: no cut has been published yet', () => {
  const { metricsScratch } = harnais();
  assert.equal(metricsScratch.drawnTriangles, null);
});

test('drawnTriangles takes the engine value as soon as a frame publishes a cut', () => {
  const { metricsScratch, fillMetrics } = harnais();
  const backend = {
    metrics: () => ({ drawnTriangles: 777, clusters: 3, selectedTriangles: 900 }),
  } as unknown as RenderBackend;
  fillMetrics(backend);
  assert.equal(metricsScratch.drawnTriangles, 777);
});

test('drawnTriangles falls back to null when the engine no longer publishes it (engine that does not hold it)', () => {
  const { metricsScratch, fillMetrics } = harnais();
  fillMetrics({ metrics: () => ({ drawnTriangles: 42 }) } as unknown as RenderBackend);
  assert.equal(metricsScratch.drawnTriangles, 42);
  fillMetrics({ metrics: () => ({}) } as unknown as RenderBackend);
  assert.equal(metricsScratch.drawnTriangles, null, 'never the previous-frame value kept');
});

// #349: the effect chain the host composes holds targets of its own; they count with the frame's.
test('the host chain adds its target bytes to the frame targets, published or not', () => {
  const { metricsScratch, fillMetrics } = harnais(96);
  fillMetrics({ metrics: () => ({}) } as unknown as RenderBackend);
  assert.equal(metricsScratch.gpuFrameTargetBytes, 96, 'WebGL2 counts no other target');
  fillMetrics({ metrics: () => ({ gpuFrameTargetBytes: 1000 }) } as unknown as RenderBackend);
  assert.equal(metricsScratch.gpuFrameTargetBytes, 1096);
  const without = harnais();
  without.fillMetrics({ metrics: () => ({}) } as unknown as RenderBackend);
  assert.equal(without.metricsScratch.gpuFrameTargetBytes, null, 'no chain: still unmeasured');
});
