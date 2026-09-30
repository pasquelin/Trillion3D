// The WebGL2 frame time (#840): with `EXT_disjoint_timer_query_webgl2` granted, the host's draw
// times each image and the frame metrics carry its GPU duration, with no per-step profile asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerDraw } from './draw.ts';
import { createExplorerMetrics } from '../diagnostic/metrics.ts';
import { gpuPassBlockTotals } from '../../gpu/core/passBlocks.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import type { MeasuredWorldOptions, RenderBackend } from '../../backend/types.ts';

const QUERY_RESULT_AVAILABLE = 0x8867;

/** A context that grants the timer extension; every query is ready at once and took 1.5 ms. */
function timedContext() {
  let queries = 0;
  return {
    getExtension: (name: string) =>
      name === 'EXT_disjoint_timer_query_webgl2'
        ? { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }
        : null,
    createQuery: () => ({ id: queries++ }),
    beginQuery() {},
    endQuery() {},
    flush() {},
    getQueryParameter: (_query: unknown, name: number) =>
      name === QUERY_RESULT_AVAILABLE ? true : 1_500_000,
    getParameter: () => false,
    deleteQuery() {},
    QUERY_RESULT_AVAILABLE,
    QUERY_RESULT: 0x8866,
  } as unknown as WebGL2RenderingContext;
}

function world(extension: boolean) {
  const backend = {
    id: 'autonomous-pages-webgl',
    overBudget: false,
    render() {},
    pendingUrls: () => [],
    metrics: () => ({}),
  } as unknown as RenderBackend;
  const streamer = {
    has: () => true,
    loading: () => false,
    failed: () => false,
    stats: () => ({ loading: 0, loaded: 0, bytesRead: 0, requested: 0, hits: 0, misses: 0 }),
  };
  const state = { measuring: false, fallbackReason: null, active: backend, hostFrame: 0 };
  const context = extension
    ? timedContext()
    : ({ getExtension: () => null } as unknown as WebGL2RenderingContext);
  const draw = createExplorerDraw(
    { scope: 'test', emit() {}, diagnose() {}, options: {} } as never,
    {
      camera: {} as never,
      geometryUrls: new Set(),
      streamer: streamer as never,
      streaming: {
        decodeFailures: new Set(),
        queuedFetch: new Set(),
        lastPrefetch: Infinity,
      } as never,
      directGpu: false,
      webglSurface: { context } as never,
      baseline: backend,
      state,
      compose: (() => {}) as never,
    },
  );
  const { metricsScratch, fillMetrics } = createExplorerMetrics(
    {} as ClusterManifest,
    {} as MeasuredWorldOptions,
    streamer as never,
    0,
    0,
    () => ({ loaded: 0, pageBytesRead: 0, streamingError: null, effectBytes: 0, gpu: draw.gpu }),
  );
  /** One host frame, `held` or drawn: the draw, then the metrics it publishes. */
  return (held = false) => {
    (backend as { frameHeld?: boolean }).frameHeld = held;
    state.hostFrame++;
    draw(backend, null);
    fillMetrics(backend);
    return metricsScratch;
  };
}

test('with the timer extension, the frame metrics carry the GPU time of the image it timed', () => {
  const frame = world(true);
  const metrics = frame();
  assert.equal(metrics.gpuFrameMs, 1.5, 'a GPU time, never "unmeasured"');
  assert.equal(metrics.gpuPassMs?.frame, 1, 'the sample names the image it timed');
  assert.deepEqual(
    gpuPassBlockTotals(metrics.gpuPassMs),
    { visibilityMs: null, materialsMs: null, otherMs: 1.5 },
    'a path that names no pass still publishes one whole-frame interval',
  );
  assert.equal(frame().gpuPassMs?.frame, 2, 'one sample per image timed');
});

test('without the extension, the GPU time stays unmeasured', () => {
  const metrics = world(false)();
  assert.equal(metrics.gpuFrameMs, null);
  assert.equal(metrics.gpuPassMs, null);
});

test('a held image put back publishes no GPU time until the next drawing', () => {
  const frame = world(true);
  assert.equal(frame().gpuFrameMs, 1.5);
  const held = frame(true);
  assert.deepEqual([held.gpuFrameMs, held.gpuPassMs], [null, null], 'the copy times no drawing');
  assert.equal(frame().gpuPassMs?.frame, 3, 'the next drawing is timed again');
});
