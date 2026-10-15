import { clamp } from '../../../math/src/scalar/reals.ts'
import { MIB } from '../../../math/src/constants.ts'
import type { TelemetryReport } from './telemetryTypes.ts'
import type { FrameMetrics } from '../../../sdk-core/src/contracts/metrics.ts'
import { frameStatistics, STUTTER_MS } from '../../../sdk-core/src/runtime/stats.ts'
import { FALLBACK_REFRESH_MS, SECOND_MS } from '../frame/scaleTargets.ts'
import { DEFAULT_PAGE_WORKERS } from '../engine/common.ts'

/** Judged on the slowest display the engine draws for (60 Hz): submit chokes past half its frame. */
const FRAME_RATE = Math.round(SECOND_MS / FALLBACK_REFRESH_MS),
  SUBMIT_MS = FALLBACK_REFRESH_MS / 2

/** The first limit the frame hits: stutters, main thread, submit, pages past the fetch workers. */
function diagnoseBottleneck(
  stutters: number,
  cpuFrameMs: number,
  cpuSubmitMs: number | null,
  pagesLoading: number,
): Pick<TelemetryReport, 'bottleneck' | 'bottleneckMessage'> {
  if (stutters > 0)
    return {
      bottleneck: 'memory_pressure',
      bottleneckMessage: `⚠️ Stutters detected (${stutters} frame(s) > ${STUTTER_MS}ms)`,
    }
  if (cpuFrameMs > FALLBACK_REFRESH_MS)
    return {
      bottleneck: 'cpu_bound',
      bottleneckMessage: `⚠️ Main CPU thread choke (${cpuFrameMs.toFixed(1)} ms)`,
    }
  if (cpuSubmitMs != null && cpuSubmitMs > SUBMIT_MS)
    return {
      bottleneck: 'gpu_submit_bound',
      bottleneckMessage: `⚠️ WebGPU submit choke (${cpuSubmitMs.toFixed(1)} ms)`,
    }
  if (pagesLoading > DEFAULT_PAGE_WORKERS)
    return {
      bottleneck: 'streaming_bound',
      bottleneckMessage: `⚠️ Network / streaming choke (${pagesLoading} pages in flight)`,
    }
  return { bottleneck: 'healthy', bottleneckMessage: `✅ Smooth pipeline (${FRAME_RATE}+ FPS)` }
}

/** The triangle block of the report: source, selected and submitted counts and the culled share. */
function trianglesReport(
  m: FrameMetrics | null | undefined,
  sourceTriangles: number,
): TelemetryReport['triangles'] {
  const source = sourceTriangles || m?.totalSubmittedTriangles || 0
  const submitted = m?.submittedTriangles ?? m?.totalSubmittedTriangles ?? null
  const cullingRate =
    source > 0 && submitted != null ? clamp((1 - submitted / source) * 100, 0, 100) : null
  return {
    source,
    selected: m?.selectedTriangles ?? null,
    submitted,
    cullingRatePercent: cullingRate != null ? Math.round(cullingRate * 10) / 10 : null,
  }
}

/** The streaming block of the report: page counts, bytes read and the cache hit rate. */
function streamingReport(m: FrameMetrics | null | undefined): TelemetryReport['streaming'] {
  const hits = m?.cacheHits ?? 0
  const misses = m?.cacheMisses ?? 0
  const cacheHitRate = hits + misses > 0 ? (hits / (hits + misses)) * 100 : null
  return {
    residentPages: m?.residentPages ?? null,
    pageLoads: m?.pageLoads ?? 0,
    pageBytesReadMb: m?.pageBytesRead ? Math.round((m.pageBytesRead / MIB) * 10) / 10 : 0,
    pagesRequested: m?.pagesRequested ?? null,
    pagesLoading: m?.pagesLoading ?? null,
    cacheHitRate: cacheHitRate != null ? Math.round(cacheHitRate * 10) / 10 : null,
  }
}

/** The report of the recent frames: their display intervals, oldest first, the last frame's
 *  metrics, and the loaded model's source triangles and clusters. */
export function frameReport(
  intervals: number[],
  m: FrameMetrics | null,
  sourceTriangles: number,
  totalClusters: number,
): TelemetryReport {
  const stats = frameStatistics(intervals)
  const cpuFrameMs = m?.cpuFrameMs ?? 0
  const cpuSubmitMs = m?.cpuSubmitMs ?? null
  const stutters = stats.stutters ?? 0
  const pagesLoading = m?.pagesLoading ?? 0
  const { bottleneck, bottleneckMessage } = diagnoseBottleneck(
    stutters,
    cpuFrameMs,
    cpuSubmitMs,
    pagesLoading,
  )

  return {
    timestamp: Date.now(),
    fps: stats.fps ? Math.round(stats.fps * 10) / 10 : null,
    p50Ms: stats.p50Ms ? Math.round(stats.p50Ms * 100) / 100 : null,
    p95Ms: stats.p95Ms ? Math.round(stats.p95Ms * 100) / 100 : null,
    p99Ms: stats.p99Ms ? Math.round(stats.p99Ms * 100) / 100 : null,
    stutters: stats.stutters,
    cpuFrameMs: Math.round(cpuFrameMs * 100) / 100,
    cpuSubmitMs: cpuSubmitMs != null ? Math.round(cpuSubmitMs * 100) / 100 : null,
    vramMb: m?.vramBytes ? Math.round((m.vramBytes / MIB) * 10) / 10 : null,
    triangles: trianglesReport(m, sourceTriangles),
    clusters: {
      total: totalClusters || m?.clusters || 0,
      visible: m?.clusters ?? null,
      frustumCulled: m?.frustumRejected ?? null,
    },
    streaming: streamingReport(m),
    bottleneck,
    bottleneckMessage,
  }
}

/** A report as text, for the console. */
export function formatFrameReport(r: TelemetryReport): string {
  const fpsStr = r.fps != null ? `${r.fps} FPS` : 'Waiting...'
  const p50Str = r.p50Ms != null ? `${r.p50Ms} ms` : '-'
  const p95Str = r.p95Ms != null ? `${r.p95Ms} ms` : '-'
  const p99Str = r.p99Ms != null ? `${r.p99Ms} ms` : '-'
  const vramStr = r.vramMb != null ? `${r.vramMb} MB` : '-'
  const cullStr =
    r.triangles.cullingRatePercent != null ? `${r.triangles.cullingRatePercent}% culled` : '-'

  const sourceTriStr = r.triangles.source.toLocaleString()
  const selTriStr = r.triangles.selected != null ? r.triangles.selected.toLocaleString() : '-'
  const subTriStr = r.triangles.submitted != null ? r.triangles.submitted.toLocaleString() : '-'

  const visClust = r.clusters.visible ?? '-'
  const totClust = r.clusters.total || '-'
  const frustumCulled = r.clusters.frustumCulled ?? 0

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
  ].join('\n')
}
