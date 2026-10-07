// Synchronous triangles batch: `drawnTriangles` enters `ENGINE_METRIC_KEYS`, so `fillMetrics`
// copies it like any other engine measurement — `null` before the first frame (no cut),
// never `null` once an engine has published a cut and its drawn-triangle count.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createExplorerMetrics } from './metrics.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts'
import type { MeasuredWorldOptions, Engine } from '../../engine/types.ts'
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
/** What an engine publishes of every frame (`EngineMetrics`), unmeasured. */
const HELD = {
  clusters: null,
  selectedTriangles: null,
  residentPages: null,
  geometryAllocationBytes: null,
  drawCalls: 0,
}

/** The sample of an engine whose next frame publishes `frame.published`. */
function harness() {
  const frame: { published: object } = { published: HELD }
  const engine = { metrics: () => frame.published } as unknown as Engine
  const metrics = createExplorerMetrics(
    engine,
    {} as ClusterManifest,
    {} as MeasuredWorldOptions,
    streamer,
    0,
    0,
    () => ({
      loaded: 0,
      pageBytesRead: 0,
      streamingError: null,
    }),
  )
  /** Publishes `published` as the engine's next frame and copies it. */
  const fill = (published: object) => {
    frame.published = { ...HELD, ...published }
    metrics.fillMetrics()
  }
  return { metricsScratch: metrics.metricsScratch, fill }
}

test('drawnTriangles is null before any sampled frame: no cut has been published yet', () => {
  const { metricsScratch } = harness()
  assert.equal(metricsScratch.drawnTriangles, null)
})

test('drawnTriangles takes the engine value as soon as a frame publishes a cut', () => {
  const { metricsScratch, fill } = harness()
  fill({ drawnTriangles: 777, clusters: 3, selectedTriangles: 900 })
  assert.equal(metricsScratch.drawnTriangles, 777)
})

test('drawnTriangles falls back to null when the engine no longer publishes it (engine that does not hold it)', () => {
  const { metricsScratch, fill } = harness()
  fill({ drawnTriangles: 42 })
  assert.equal(metricsScratch.drawnTriangles, 42)
  fill({})
  assert.equal(metricsScratch.drawnTriangles, null, 'never the previous-frame value kept')
})

test('the frame interval, the measured refresh and the GPU idle are copied as the engine holds them', () => {
  const { metricsScratch, fill } = harness()
  assert.equal(metricsScratch.displayRefreshMs, null)
  fill({ rafIntervalMs: 16.6, displayRefreshMs: 8.3, gpuIdleMs: 0.4 })
  assert.equal(metricsScratch.rafIntervalMs, 16.6)
  assert.equal(metricsScratch.displayRefreshMs, 8.3)
  assert.equal(metricsScratch.gpuIdleMs, 0.4)
})

test('the drawn size is the engine’s own, unmeasured when it publishes none', () => {
  const { metricsScratch, fill } = harness()
  fill({})
  assert.equal(metricsScratch.renderWidth, null, 'no image drawn: unmeasured')
  fill({ renderWidth: 48, renderHeight: 24 })
  assert.deepEqual([metricsScratch.renderWidth, metricsScratch.renderHeight], [48, 24])
})
