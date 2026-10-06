// Synchronous triangles batch: `drawnTriangles` enters `BACKEND_METRIC_KEYS`, so `fillMetrics`
// copies it like any other engine measurement — `null` before the first frame (no cut),
// never `null` once an engine has published a cut and its drawn-triangle count.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createExplorerMetrics } from './metrics.ts'
import { createScaleControl } from '../../frame/scaleControl.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts'
import type { MeasuredWorldOptions, RenderBackend } from '../../backend/types.ts'
import type { createPageStreamer } from '../../streaming/pageStreamer.ts'

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
} as unknown as ReturnType<typeof createPageStreamer>
function harness(effectBytes = 0, renderSize: readonly [number, number] | null = null) {
  return createExplorerMetrics(
    {} as ClusterManifest,
    {} as MeasuredWorldOptions,
    streamer,
    0,
    0,
    () => ({
      loaded: 0,
      pageBytesRead: 0,
      streamingError: null,
      effectBytes,
      renderSize,
      gpu: { frameMs: null, passes: null },
    }),
  )
}

test('drawnTriangles is null before any sampled frame: no cut has been published yet', () => {
  const { metricsScratch } = harness()
  assert.equal(metricsScratch.drawnTriangles, null)
})

test('drawnTriangles takes the engine value as soon as a frame publishes a cut', () => {
  const { metricsScratch, fillMetrics } = harness()
  const backend = {
    metrics: () => ({ drawnTriangles: 777, clusters: 3, selectedTriangles: 900 }),
  } as unknown as RenderBackend
  fillMetrics(backend)
  assert.equal(metricsScratch.drawnTriangles, 777)
})

test('drawnTriangles falls back to null when the engine no longer publishes it (engine that does not hold it)', () => {
  const { metricsScratch, fillMetrics } = harness()
  fillMetrics({ metrics: () => ({ drawnTriangles: 42 }) } as unknown as RenderBackend)
  assert.equal(metricsScratch.drawnTriangles, 42)
  fillMetrics({ metrics: () => ({}) } as unknown as RenderBackend)
  assert.equal(metricsScratch.drawnTriangles, null, 'never the previous-frame value kept')
})

// #349: the effect chain the host composes holds targets of its own; they count with the frame's.
test('the host chain adds its target bytes to the frame targets, published or not', () => {
  const { metricsScratch, fillMetrics } = harness(96)
  fillMetrics({ metrics: () => ({}) } as unknown as RenderBackend)
  assert.equal(metricsScratch.gpuFrameTargetBytes, 96, 'WebGL2 counts no other target')
  fillMetrics({ metrics: () => ({ gpuFrameTargetBytes: 1000 }) } as unknown as RenderBackend)
  assert.equal(metricsScratch.gpuFrameTargetBytes, 1096)
  const without = harness()
  without.fillMetrics({ metrics: () => ({}) } as unknown as RenderBackend)
  assert.equal(without.metricsScratch.gpuFrameTargetBytes, null, 'no chain: still unmeasured')
})

test('the frame interval, the measured refresh and the GPU idle are copied as the engine holds them', () => {
  const { metricsScratch, fillMetrics } = harness()
  assert.equal(metricsScratch.displayRefreshMs, null)
  const backend = {
    metrics: () => ({ rafIntervalMs: 16.6, displayRefreshMs: 8.3, gpuIdleMs: 0.4 }),
  } as unknown as RenderBackend
  fillMetrics(backend)
  assert.equal(metricsScratch.rafIntervalMs, 16.6)
  assert.equal(metricsScratch.displayRefreshMs, 8.3)
  assert.equal(metricsScratch.gpuIdleMs, 0.4)
})

test('an engine whose scale the host ticks publishes the cadence of that clock', () => {
  const { metricsScratch, fillMetrics } = harness()
  const renderScaleControl = createScaleControl(undefined, 1)
  for (let frame = 0; frame < 4; frame++) renderScaleControl.tick((frame * 1000) / 120)
  fillMetrics({ metrics: () => ({}), renderScaleControl } as unknown as RenderBackend)
  assert.ok(Math.abs(metricsScratch.rafIntervalMs! - 1000 / 120) < 1e-9)
  assert.ok(Math.abs(metricsScratch.displayRefreshMs! - 1000 / 120) < 1e-9)
})

test('the drawn size is the engine’s, else the size the host composer drew the image at', () => {
  const composed = harness(0, [32, 16])
  composed.fillMetrics({ metrics: () => ({}) } as unknown as RenderBackend)
  assert.deepEqual(
    [composed.metricsScratch.renderWidth, composed.metricsScratch.renderHeight],
    [32, 16],
  )
  const own = {
    metrics: () => ({ renderWidth: 48, renderHeight: 24 }),
  } as unknown as RenderBackend
  composed.fillMetrics(own)
  assert.deepEqual(
    [composed.metricsScratch.renderWidth, composed.metricsScratch.renderHeight],
    [48, 24],
  )
  const none = harness()
  none.fillMetrics({ metrics: () => ({}) } as unknown as RenderBackend)
  assert.equal(none.metricsScratch.renderWidth, null, 'no image drawn: unmeasured')
})
