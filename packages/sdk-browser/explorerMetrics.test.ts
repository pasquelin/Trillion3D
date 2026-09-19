// Lot triangles synchrones : `drawnTriangles` entre dans `BACKEND_METRIC_KEYS`, donc `fillMetrics`
// copies it like any other engine measurement — `null` before the first frame (no cut),
// never `null` once an engine has published a cut and its drawn-triangle count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerMetrics } from './explorerMetrics.ts';
import type { ClusterManifest } from '../sdk-core/index.ts';
import type { ExplorerOptions, RenderBackend } from './backendTypes.ts';
import type { createPageStreamer } from './streamingPages.ts';

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
const state = () => ({ loaded: 0, pageBytesRead: 0, streamingError: null });

function harnais() {
  return createExplorerMetrics({} as ClusterManifest, {} as ExplorerOptions, streamer, 0, 0, state);
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
