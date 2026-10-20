import test from 'node:test'
import assert from 'node:assert/strict'
import { EngineProfiler } from './telemetry.ts'
import { referenceIntervals } from '../../../../bench/oracles/browser/telemetry.ts'
import type { FrameMetrics } from '../../../sdk-core/src/contracts/metrics.ts'
import type { ClusterManifest } from '../../../sdk-core/src/contracts/geometry.ts'
import { MIB } from '../../../math/src/constants.ts'
import { FALLBACK_REFRESH_MS } from '../frame/scale/scaleTargets.ts'

test('the frame report records frames and produces accurate statistics and bottlenecks', () => {
  const profiler = new EngineProfiler()
  const manifest: ClusterManifest = {
    formatVersion: 1,
    status: 'ready',
    key: 'test',
    scope: 'slice',
    sourceTriangles: 1000000,
    selectedTriangles: 50000,
    selectedNodes: 1,
    totalNodes: 500,
    primitives: [],
  }
  profiler.setMetadata(manifest)

  const baseMetrics: FrameMetrics = {
    rafIntervalMs: 16.6,
    cpuFrameMs: 3.2,
    cpuSubmitMs: 0.8,
    drawCalls: 6,
    clusters: 150,
    selectedTriangles: 50000,
    residentPages: 150,
    submittedTriangles: 25000,
    frustumRejected: 300,
    pageLoads: 150,
    pageBytesRead: MIB * 5,
    geometryAllocationBytes: null,
    vramBytes: MIB * 32,
    cacheHits: 140,
    cacheMisses: 10,
    pagesRequested: 150,
    pagesLoading: 0,
  }

  // 10 smooth frames at ~16.6 ms (60 FPS), the interval the refresh clock measured.
  for (let i = 0; i < 10; i++) profiler.record(baseMetrics)

  const report = profiler.getReport()
  assert.ok(report.fps !== null && report.fps >= 58 && report.fps <= 62)
  assert.equal(report.triangles.source, 1000000)
  assert.equal(report.triangles.submitted, 25000)
  assert.equal(report.triangles.cullingRatePercent, 97.5)
  assert.equal(report.clusters.total, 500)
  assert.equal(report.clusters.visible, 150)
  assert.equal(report.bottleneck, 'healthy')

  const text = profiler.formatReport()
  assert.ok(text.includes('TRILLION3D ENGINE TELEMETRY REPORT'))
  assert.ok(text.includes('97.5% culled'))
  assert.ok(text.includes('32 MB VRAM'))
})

test('the frame report diagnoses CPU bound state when cpuFrameMs exceeds budget', () => {
  const profiler = new EngineProfiler()
  const heavyMetrics: FrameMetrics = {
    rafIntervalMs: 35.0,
    cpuFrameMs: 25.4,
    cpuSubmitMs: 2.0,
    drawCalls: 10,
    clusters: 50,
    selectedTriangles: 10000,
    residentPages: 50,
    pageLoads: 50,
    pageBytesRead: MIB,
    geometryAllocationBytes: null,
    vramBytes: null,
  }

  profiler.record(heavyMetrics)
  profiler.record(heavyMetrics)

  const report = profiler.getReport()
  assert.equal(report.bottleneck, 'cpu_bound')
  assert.ok(report.bottleneckMessage.includes('CPU thread choke'))
})

test('the main thread chokes past a frame of a 60 Hz display, the engine one 60 Hz frame', () => {
  const bottleneck = (cpuFrameMs: number) => {
    const profiler = new EngineProfiler()
    profiler.record({ cpuFrameMs } as FrameMetrics)
    return profiler.getReport().bottleneck
  }
  assert.equal(bottleneck(16.65), 'healthy', 'within 1000 / 60 ms: no hand-rounded 16.6')
  assert.equal(bottleneck(FALLBACK_REFRESH_MS + 0.01), 'cpu_bound')
})

// `record()` writes into a circular buffer instead of `push` then `shift()` of the whole
// array. Oracle: the reference `push`/`shift` version, in
// `../../../../bench/oracles/browser/telemetry.ts`.
test('the circular interval buffer matches push+shift after wraparound and frames with no interval', () => {
  const max = 5
  const profiler = new EngineProfiler(max)
  // A frame after a pause has no interval (`null`), nor one drawn twice in a display frame (0).
  const intervals = [null, 10, 0, null, 12, 8, 9, 11, 7, 13]
  for (const dt of intervals) profiler.record({ rafIntervalMs: dt } as never)
  const optimized = profiler.orderedIntervals()
  const reference = referenceIntervals(
    max,
    intervals.map((dt) => dt ?? 0),
  )
  assert.deepEqual(optimized, reference)
})

test('a profiler that never records a valid interval reports an empty, not undefined, list', () => {
  const profiler = new EngineProfiler(3)
  profiler.record({ rafIntervalMs: null } as never)
  profiler.record({ rafIntervalMs: 0 } as never)
  assert.deepEqual(profiler.orderedIntervals(), referenceIntervals(3, [0]))
  assert.deepEqual(profiler.orderedIntervals(), [])
})

test('the profiler reports from its first frame, no code to wait for', () => {
  const profiler = new EngineProfiler(),
    frame = { cpuFrameMs: 2, rafIntervalMs: 10 } as never
  for (let i = 0; i < 10; i++) profiler.record(frame)
  assert.equal(profiler.getReport().fps, 100)
  assert.deepEqual(profiler.orderedIntervals(), Array(10).fill(10))
})
