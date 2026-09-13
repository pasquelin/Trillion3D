import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineProfiler } from './telemetry.ts';
import type { FrameMetrics, ClusterManifest } from '../sdk-core/index.ts';

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
  assert.ok(text.includes('RAPPORT TÉLÉMÉTRIE MOTEUR WEBGEOMETRY'));
  assert.ok(text.includes('97.5% culled'));
  assert.ok(text.includes('32 Mo VRAM'));
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
  };

  profiler.record(heavyMetrics, 1000);
  profiler.record(heavyMetrics, 1035);

  const report = profiler.getReport();
  assert.equal(report.bottleneck, 'cpu_bound');
  assert.ok(report.bottleneckMessage.includes('Choke CPU'));
});
