import type { ClusterManifest } from '../../../sdk-core/src/contracts/geometry.ts'
import type { FrameMetrics } from '../../../sdk-core/src/contracts/metrics.ts'
import type { TelemetryReport } from './telemetryTypes.ts'
import { formatFrameReport, frameReport } from './frameProfile.ts'
import { setDebugMode } from '../host/debugMode.ts'
import { log } from './log.ts'

/**
 * THE ENGINE'S ONE PROFILER: it watches frame after frame and says how smoothly the engine runs,
 * and what slows it. Its frames are the display intervals the refresh clock measured
 * (`rafIntervalMs`), kept in a ring — one write per frame, never a shift of the whole array —, and
 * its report is computed when asked (`frameReport`). A page files frames into it only in debug
 * mode (`../world/render/render.ts`), so a shipping page records nothing.
 */
export class EngineProfiler {
  private readonly intervals: Float64Array
  private intervalCount = 0
  private intervalHead = 0
  private lastMetrics: FrameMetrics | null = null
  private sourceTriangles = 0
  private totalClusters = 0
  private autoLogTimer: ReturnType<typeof setInterval> | null = null

  constructor(maxIntervals = 120) {
    this.intervals = new Float64Array(Math.max(1, maxIntervals))
  }

  /** Kept intervals, from oldest to newest: what `frameStatistics` receives. */
  orderedIntervals(): number[] {
    const size = this.intervals.length,
      ordered = new Array<number>(this.intervalCount)
    const first = this.intervalCount === size ? this.intervalHead : 0
    for (let i = 0; i < this.intervalCount; i++) ordered[i] = this.intervals[(first + i) % size]
    return ordered
  }

  /** Tells it which model is loaded. */
  setMetadata(metadata: ClusterManifest) {
    this.sourceTriangles = metadata.sourceTriangles || 0
    this.totalClusters = metadata.totalNodes || 0
  }

  /** Records one frame's metrics: its display interval the refresh clock measured
   *  (`rafIntervalMs`, none after a pause), never one of its own. */
  record(metrics: FrameMetrics) {
    const dt = metrics.rafIntervalMs
    if (dt != null && dt > 0) {
      this.intervals[this.intervalHead] = dt
      this.intervalHead = (this.intervalHead + 1) % this.intervals.length
      if (this.intervalCount < this.intervals.length) this.intervalCount++
    }
    this.lastMetrics = metrics
  }

  /** A summary of the recent frames. */
  getReport(): TelemetryReport {
    const { lastMetrics, sourceTriangles, totalClusters } = this
    return frameReport(this.orderedIntervals(), lastMetrics, sourceTriangles, totalClusters)
  }

  /** That summary as text. */
  formatReport(): string {
    return formatFrameReport(this.getReport())
  }

  /** Prints that summary to the console. */
  printReport() {
    log.info(this.formatReport())
  }

  /** Prints it every few seconds, in debug mode, which alone files the report; returns a stop. */
  startAutoLog(intervalSeconds = 2): () => void {
    setDebugMode(true)
    this.stopAutoLog()
    this.autoLogTimer = setInterval(() => this.printReport(), Math.max(0.5, intervalSeconds) * 1000)
    return () => this.stopAutoLog()
  }

  /** Stops printing. */
  stopAutoLog() {
    if (this.autoLogTimer != null) {
      clearInterval(this.autoLogTimer)
      this.autoLogTimer = null
    }
  }

  /** Stops and forgets everything. */
  dispose() {
    this.stopAutoLog()
    this.intervalCount = 0
    this.intervalHead = 0
    this.lastMetrics = null
  }
}
