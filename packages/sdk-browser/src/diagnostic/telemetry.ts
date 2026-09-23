import type { TelemetryReport } from './telemetryTypes.ts';
export type { TelemetryReport } from './telemetryTypes.ts';
import type { FrameMetrics, ClusterManifest } from '../../../sdk-core/src/index.ts';
import { frameStatistics } from '../../../sdk-core/src/index.ts';

/** Watches frame after frame and says how smoothly the engine runs, and what slows it. */
export class EngineProfiler {
  /** Circular interval buffer: one write per frame, never a shift of the whole
   *  array. `frameStatistics` receives the same values, in the same order, from oldest to
   *  newest. */
  private readonly intervals: Float64Array;
  private intervalCount = 0;
  private intervalHead = 0;
  private readonly maxIntervals: number;
  private lastTime = 0;
  private lastMetrics: FrameMetrics | null = null;
  private sourceTriangles = 0;
  private totalClusters = 0;
  private autoLogTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxIntervals = 120) {
    this.maxIntervals = maxIntervals;
    this.intervals = new Float64Array(Math.max(1, maxIntervals));
  }

  /** Kept intervals, from oldest to newest: what `frameStatistics` receives. */
  orderedIntervals() {
    const taille = this.intervals.length,
      ordered = new Array<number>(this.intervalCount);
    const debut = this.intervalCount === taille ? this.intervalHead : 0;
    for (let i = 0; i < this.intervalCount; i++) ordered[i] = this.intervals[(debut + i) % taille];
    return ordered;
  }

  /** Tells it which model is loaded. */
  setMetadata(metadata: ClusterManifest) {
    this.sourceTriangles = metadata.sourceTriangles || 0;
    this.totalClusters = metadata.totalNodes || 0;
  }

  /** Records one frame's metrics. */
  record(metrics: FrameMetrics, now = performance.now()) {
    if (this.lastTime > 0) {
      const dt = now - this.lastTime;
      if (dt > 0 && dt < 1000) {
        this.intervals[this.intervalHead] = dt;
        this.intervalHead = (this.intervalHead + 1) % this.intervals.length;
        if (this.intervalCount < this.intervals.length) this.intervalCount++;
      }
    }
    this.lastTime = now;
    this.lastMetrics = metrics;
  }

  /** A summary of the recent frames. */
  getReport(): TelemetryReport {
    const stats = frameStatistics(this.orderedIntervals());
    const m = this.lastMetrics;
    const sourceTri = this.sourceTriangles || m?.triangles || 0;
    const selectedTri = m?.selectedTriangles ?? null;
    const submittedTri = m?.submittedTriangles ?? m?.triangles ?? null;
    const cullingRate =
      sourceTri > 0 && submittedTri != null
        ? Math.max(0, Math.min(100, (1 - submittedTri / sourceTri) * 100))
        : null;

    const hits = m?.cacheHits ?? 0;
    const misses = m?.cacheMisses ?? 0;
    const cacheHitRate = hits + misses > 0 ? (hits / (hits + misses)) * 100 : null;

    const cpuFrameMs = m?.cpuFrameMs ?? 0;
    const cpuSubmitMs = m?.cpuSubmitMs ?? null;
    const stutters = stats.stutters ?? 0;
    const pagesLoading = m?.pagesLoading ?? 0;

    let bottleneck: TelemetryReport['bottleneck'] = 'healthy';
    let bottleneckMessage = '✅ Smooth pipeline (60+ FPS optimal)';

    if (stutters > 0) {
      bottleneck = 'memory_pressure';
      bottleneckMessage = `⚠️ Stutters detected (${stutters} frame(s) > 50ms)`;
    } else if (cpuFrameMs > 16.6) {
      bottleneck = 'cpu_bound';
      bottleneckMessage = `⚠️ Main CPU thread choke (${cpuFrameMs.toFixed(1)} ms)`;
    } else if (cpuSubmitMs != null && cpuSubmitMs > 8) {
      bottleneck = 'gpu_submit_bound';
      bottleneckMessage = `⚠️ WebGPU submit choke (${cpuSubmitMs.toFixed(1)} ms)`;
    } else if (pagesLoading > 20) {
      bottleneck = 'streaming_bound';
      bottleneckMessage = `⚠️ Network / streaming choke (${pagesLoading} pages in flight)`;
    }

    return {
      timestamp: Date.now(),
      fps: stats.fps ? Math.round(stats.fps * 10) / 10 : null,
      p50Ms: stats.p50Ms ? Math.round(stats.p50Ms * 100) / 100 : null,
      p95Ms: stats.p95Ms ? Math.round(stats.p95Ms * 100) / 100 : null,
      p99Ms: stats.p99Ms ? Math.round(stats.p99Ms * 100) / 100 : null,
      stutters: stats.stutters,
      cpuFrameMs: Math.round(cpuFrameMs * 100) / 100,
      cpuSubmitMs: cpuSubmitMs != null ? Math.round(cpuSubmitMs * 100) / 100 : null,
      vramMb: m?.vramBytes ? Math.round((m.vramBytes / (1024 * 1024)) * 10) / 10 : null,
      triangles: {
        source: sourceTri,
        selected: selectedTri,
        submitted: submittedTri,
        cullingRatePercent: cullingRate != null ? Math.round(cullingRate * 10) / 10 : null,
      },
      clusters: {
        total: this.totalClusters || m?.clusters || 0,
        visible: m?.clusters ?? null,
        frustumCulled: m?.frustumRejected ?? null,
      },
      streaming: {
        residentPages: m?.residentPages ?? null,
        pageLoads: m?.pageLoads ?? 0,
        pageBytesReadMb: m?.pageBytesRead
          ? Math.round((m.pageBytesRead / (1024 * 1024)) * 10) / 10
          : 0,
        pagesRequested: m?.pagesRequested ?? null,
        pagesLoading: m?.pagesLoading ?? null,
        cacheHitRate: cacheHitRate != null ? Math.round(cacheHitRate * 10) / 10 : null,
      },
      bottleneck,
      bottleneckMessage,
    };
  }

  /** That summary as text. */
  formatReport(): string {
    const r = this.getReport();
    const fpsStr = r.fps != null ? `${r.fps} FPS` : 'Waiting...';
    const p50Str = r.p50Ms != null ? `${r.p50Ms} ms` : '-';
    const p95Str = r.p95Ms != null ? `${r.p95Ms} ms` : '-';
    const p99Str = r.p99Ms != null ? `${r.p99Ms} ms` : '-';
    const vramStr = r.vramMb != null ? `${r.vramMb} MB` : '-';
    const cullStr =
      r.triangles.cullingRatePercent != null ? `${r.triangles.cullingRatePercent}% culled` : '-';

    const sourceTriStr = r.triangles.source.toLocaleString();
    const selTriStr = r.triangles.selected != null ? r.triangles.selected.toLocaleString() : '-';
    const subTriStr = r.triangles.submitted != null ? r.triangles.submitted.toLocaleString() : '-';

    const visClust = r.clusters.visible ?? '-';
    const totClust = r.clusters.total || '-';
    const frustumCulled = r.clusters.frustumCulled ?? 0;

    return [
      `═══════════════════════════════════════════════════════════════════════`,
      ` 🚀 TRILLION3D ENGINE TELEMETRY REPORT — ${fpsStr}`,
      `═══════════════════════════════════════════════════════════════════════`,
      ` ⏱️  FRAME PACE    : P50: ${p50Str} | P95: ${p95Str} | P99: ${p99Str} | Stutters: ${r.stutters ?? 0}`,
      ` 💻 CPU FRAME     : ${r.cpuFrameMs} ms | WebGPU submit: ${r.cpuSubmitMs != null ? r.cpuSubmitMs + ' ms' : '-'}`,
      ` 🔺 GEOMETRY      : ${sourceTriStr} source → ${selTriStr} LOD → ${subTriStr} submitted (${cullStr})`,
      ` 📦 CLUSTERS      : ${visClust} visible / ${totClust} total (Frustum: ${frustumCulled})`,
      ` 💾 VRAM & PAGES  : ${vramStr} VRAM | Resident pages: ${r.streaming.residentPages ?? '-'}`,
      ` 🌐 STREAMING     : ${r.streaming.pageLoads} pages loaded (${r.streaming.pageBytesReadMb} MB) | In flight: ${r.streaming.pagesLoading ?? 0} | Hit: ${r.streaming.cacheHitRate != null ? r.streaming.cacheHitRate + '%' : '-'}`,
      ` 🎯 SYSTEM STATE  : ${r.bottleneckMessage}`,
      `═══════════════════════════════════════════════════════════════════════`,
    ].join('\n');
  }

  /** Prints that summary to the console. */
  printReport() {
    if (typeof console !== 'undefined' && console.log) {
      console.log(this.formatReport());
    }
  }

  /** Prints it every few seconds; returns a function that stops. */
  startAutoLog(intervalSeconds = 2): () => void {
    this.stopAutoLog();
    this.autoLogTimer = setInterval(
      () => {
        this.printReport();
      },
      Math.max(0.5, intervalSeconds) * 1000,
    );
    return () => this.stopAutoLog();
  }

  /** Stops printing. */
  stopAutoLog() {
    if (this.autoLogTimer != null) {
      clearInterval(this.autoLogTimer);
      this.autoLogTimer = null;
    }
  }

  /** Stops and forgets everything. */
  dispose() {
    this.stopAutoLog();
    this.intervalCount = 0;
    this.intervalHead = 0;
    this.lastMetrics = null;
  }
}
