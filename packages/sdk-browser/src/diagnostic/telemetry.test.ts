import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineProfiler } from './telemetry.ts';
import { referenceIntervals } from '../../../../bench/oracles/browser/telemetry.ts';
import type { FrameMetrics, ClusterManifest } from '../../../sdk-core/src/index.ts';

test('EngineProfiler records frames and produces accurate statistics and bottlenecks', () => {
  const profiler = new EngineProfiler();
  const manifest: ClusterManifest = {
    schema: 1,
    status: 'ready',
    key: 'test',
    scope: 'slice',
    sourceTriangles: 1000000,
    selectedTriangles: 50000,
    selectedNodes: [0],
    totalNodes: 500,
    primitives: [],
  };
  profiler.setMetadata(manifest);

  const baseMetrics: FrameMetrics = {
    rafIntervalMs: 16.6,
    cpuFrameMs: 3.2,
    cpuSubmitMs: 0.8,
    gpuMs: null,
    drawCalls: 6,
    triangles: 25000,
    clusters: 150,
    selectedTriangles: 50000,
    residentPages: 150,
    submittedTriangles: 25000,
    frustumRejected: 300,
    pageLoads: 150,
    pageBytesRead: 1024 * 1024 * 5,
    geometryAllocationBytes: null,
    vramBytes: 1024 * 1024 * 32,
    cacheHits: 140,
    cacheMisses: 10,
    pagesRequested: 150,
    pagesLoading: 0,
  };

  // Simulate 10 smooth frames at ~16.6 ms (60 FPS)
  let t = 1000;
  for (let i = 0; i < 10; i++) {
    profiler.record(baseMetrics, t);
    t += 16.6;
  }

  const report = profiler.getReport();
  assert.ok(report.fps !== null && report.fps >= 58 && report.fps <= 62);
  assert.equal(report.triangles.source, 1000000);
  assert.equal(report.triangles.submitted, 25000);
  assert.equal(report.triangles.cullingRatePercent, 97.5);
  assert.equal(report.clusters.total, 500);
  assert.equal(report.clusters.visible, 150);
  assert.equal(report.bottleneck, 'healthy');

  const text = profiler.formatReport();
  assert.ok(text.includes('TRILLION3D ENGINE TELEMETRY REPORT'));
  assert.ok(text.includes('97.5% culled'));
  assert.ok(text.includes('32 MB VRAM'));
});

test('EngineProfiler diagnoses CPU bound state when cpuFrameMs exceeds budget', () => {
  const profiler = new EngineProfiler();
  const heavyMetrics: FrameMetrics = {
    rafIntervalMs: 35.0,
    cpuFrameMs: 25.4,
    cpuSubmitMs: 2.0,
    gpuMs: null,
    drawCalls: 10,
    triangles: 10000,
    clusters: 50,
    selectedTriangles: 10000,
    residentPages: 50,
    pageLoads: 50,
    pageBytesRead: 1024 * 1024,
    geometryAllocationBytes: null,
    vramBytes: null,
  };

  profiler.record(heavyMetrics, 1000);
  profiler.record(heavyMetrics, 1035);

  const report = profiler.getReport();
  assert.equal(report.bottleneck, 'cpu_bound');
  assert.ok(report.bottleneckMessage.includes('CPU thread choke'));
});

// A14: `record()` writes into a circular buffer instead of `push` then `shift()` of the whole
// array. Oracle: the `push`/`shift` version from before batch A, in
// `../../../../bench/oracles/browser/telemetry.ts`.
test('the circular interval buffer matches push+shift after wraparound and rejected deltas', () => {
  const max = 5;
  const profiler = new EngineProfiler(max);
  // The first call only sets the clock baseline; every later call produces one interval. Includes a
  // negative delta and one past the 1000 ms ceiling, both of which the filter must reject.
  const deltas = [0, 10, -3, 2000, 12, 8, 9, 11, 7, 13];
  let horloge = 0;
  for (const dt of deltas) profiler.record({} as never, (horloge += dt));
  const optimisee = profiler.orderedIntervals();
  const reference = referenceIntervals(max, deltas.slice(1));
  assert.deepEqual(optimisee, reference);
});

test('a profiler that never records a valid interval reports an empty, not undefined, list', () => {
  const profiler = new EngineProfiler(3);
  profiler.record({} as never, 100);
  profiler.record({} as never, 100); // dt === 0: rejected by `dt > 0`.
  assert.deepEqual(profiler.orderedIntervals(), referenceIntervals(3, [0]));
  assert.deepEqual(profiler.orderedIntervals(), []);
});
