import type { ClusterManifest, FrameMetrics } from '../../../sdk-core/src/index.ts';
import type { TelemetryReport } from './telemetryTypes.ts';
import type { FrameProfile } from './frameProfile.ts';
import { debugMode, setDebugMode } from '../host/debugMode.ts';
import { families } from '../host/families.ts';
export type { TelemetryReport } from './telemetryTypes.ts';

/** What the report says before the debug code has arrived. */
const WAITING = 'Waiting for the debug code';
/** The report before the debug code has arrived: no frame counted, nothing measured. */
const waitingReport = (): TelemetryReport => ({
  timestamp: Date.now(),
  fps: null,
  p50Ms: null,
  p95Ms: null,
  p99Ms: null,
  stutters: null,
  cpuFrameMs: 0,
  cpuSubmitMs: null,
  vramMb: null,
  triangles: { source: 0, selected: null, submitted: null, cullingRatePercent: null },
  clusters: { total: 0, visible: null, frustumCulled: null },
  streaming: {
    residentPages: null,
    pageLoads: 0,
    pageBytesReadMb: 0,
    pagesRequested: null,
    pagesLoading: null,
    cacheHitRate: null,
  },
  bottleneck: 'healthy',
  bottleneckMessage: WAITING,
});

/**
 * Watches frame after frame and says how smoothly the engine runs, and what slows it. As a
 * shipping build strips its stat tools (#1353), the core holds only this facade: its code is the
 * measurement's chunk (`FrameProfile`, `../host/families.ts`), fetched once debug mode turns on or
 * the profiler is first used. Until it has arrived a frame is not counted and the report says it
 * waits (`docs/SDK.md`).
 */
export class EngineProfiler {
  private readonly maxIntervals: number;
  private profile: FrameProfile | undefined;
  private metadata: ClusterManifest | undefined;
  private autoLogTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxIntervals = 120) {
    this.maxIntervals = maxIntervals;
    if (debugMode()) this.code();
  }

  /** The profile once the measurement's code has arrived; until then, asks for it. */
  private code() {
    if (this.profile) return this.profile;
    const code = families.measurement.get();
    if (!code) return undefined;
    this.profile = new code.FrameProfile(this.maxIntervals);
    if (this.metadata) this.profile.setMetadata(this.metadata);
    return this.profile;
  }

  /** Kept intervals, from oldest to newest: what `frameStatistics` receives. */
  orderedIntervals(): number[] {
    return this.code()?.orderedIntervals() ?? [];
  }

  /** Tells it which model is loaded. */
  setMetadata(metadata: ClusterManifest) {
    this.metadata = metadata;
    this.profile?.setMetadata(metadata);
  }

  /** Records one frame's metrics. */
  record(metrics: FrameMetrics, now = performance.now()) {
    this.code()?.record(metrics, now);
  }

  /** A summary of the recent frames. */
  getReport(): TelemetryReport {
    return this.code()?.getReport() ?? waitingReport();
  }

  /** That summary as text. */
  formatReport(): string {
    return this.code()?.formatReport() ?? `Trillion3D telemetry: ${WAITING}`;
  }

  /** Prints that summary to the console. */
  printReport() {
    if (typeof console !== 'undefined' && console.log) console.log(this.formatReport());
  }

  /** Prints it every few seconds, in debug mode, which alone files the report; returns a stop. */
  startAutoLog(intervalSeconds = 2): () => void {
    setDebugMode(true);
    this.stopAutoLog();
    this.autoLogTimer = setInterval(
      () => this.printReport(),
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
    this.profile?.dispose();
  }
}
