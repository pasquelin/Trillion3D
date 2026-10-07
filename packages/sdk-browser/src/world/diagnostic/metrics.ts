import { mathBatchMetrics } from '../../math/batchState.ts'
import { pageIntegrationStats } from '../../page/integration/host.ts'
import { pageWorkStats } from '../../page/work/host.ts'
import { EngineProfiler } from '../../diagnostic/telemetry.ts'
import type { FrameMetrics, ClusterManifest } from '../../../../sdk-core/src/index.ts'
import type { MeasuredWorldOptions, Engine } from '../../engine/types.ts'
import { ENGINE_METRIC_KEYS, type EngineMetrics } from '../../diagnostic/metricKeys.ts'
import type { createPageStreamer } from '../../streaming/pageStreamer.ts'

type State = () => {
  loaded: number
  pageBytesRead: number
  streamingError: string | null
}

/** Copies an engine measurement into the host sample: `null` when that engine does not hold it. */
function publishMetric<K extends (typeof ENGINE_METRIC_KEYS)[number]>(
  into: FrameMetrics,
  from: EngineMetrics,
  key: K,
) {
  into[key] = (from[key] ?? null) as FrameMetrics[K]
}

/** The host sample before any frame: every measurement `null` — not held —, none zero but the
 *  frame time and the counts the open carries in. */
const UNMEASURED: FrameMetrics = {
  rafIntervalMs: null,
  displayRefreshMs: null,
  cpuFrameMs: 0,
  cpuSelectNodesTested: null,
  cpuSubmitMs: null,
  drawCalls: null,
  triangles: null,
  clusters: null,
  selectedTriangles: null,
  residentPages: null,
  geometryAllocationBytes: null,
  vramBytes: null,
  pageLoads: 0,
  pageBytesRead: 0,
  pagesDetached: null,
  cacheEvictions: null,
  hizCountedFrame: null,
  hizTestedClusters: null,
  hizRejectedClusters: null,
  hizOversizedClusters: null,
  hizTestedTriangles: null,
  hizRejectedTriangles: null,
  hizOversizedTriangles: null,
  gpuPassMs: null,
  gpuFrameMs: null,
  gpuHostGapMs: null,
  gpuIdleMs: null, // device idle between two images (#1451)
  gpuDeviceLost: null,
  uncoveredTriangles: null,
  drawnTriangles: null,
  lightsActive: null,
  lightsSampled: null,
  shadowVsmLights: null,
  shadowVsmMaps: null,
  shadowVsmPagesRequested: null,
  shadowVsmPagesAllocated: null,
  shadowVsmPagesCached: null,
  shadowVsmPagesRendered: null,
  shadowVsmFreePages: null,
  shadowVsmLodBias: null,
  shadowVsmProjectionPasses: null,
  shadowVsmInvalidationMs: null,
  shadowVsmMarkingMs: null,
  shadowVsmPageManagementMs: null,
  shadowVsmRenderMs: null,
  shadowVsmProjectionMs: null,
  shadowVsmTransmissionMs: null,
  shadowPoolBytes: null,
  shadowResolutionBias: null,
  tileLightPoolReserved: null,
  tileLightPoolCapacity: null,
  tileLightPoolOverflowed: null,
  tileLightPoolGrowths: null,
  gpuLightListsMs: null,
  gpuShadowsMs: null,
  gpuShadowCullMs: null,
  gpuShadowRasterMs: null,
  gpuLightingMs: null,
  texturePoolBytes: null,
  texturePoolFormat: null,
  textureResidentBytes: null,
  textureBytesLastFrame: null,
  pagesChecked: null,
  pageCheckMs: null,
  mathBatch: null,
}

/** The host sample of `engine`'s frames: `fillMetrics` copies the last frame's into it. */
export function createExplorerMetrics(
  engine: Engine,
  metadata: ClusterManifest,
  options: MeasuredWorldOptions,
  streamer: ReturnType<typeof createPageStreamer>,
  loaded: number,
  pageBytesRead: number,
  state: State,
) {
  const metricsScratch: FrameMetrics = { ...UNMEASURED, pageLoads: loaded, pageBytesRead }
  const profiler = new EngineProfiler()
  profiler.setMetadata(metadata)
  if (options.logInterval && options.logInterval > 0) profiler.startAutoLog(options.logInterval)
  const fillMetrics = () => {
    const { loaded, pageBytesRead, streamingError } = state()
    const published = engine.metrics()
    const stream = streamer.stats()
    // Every measurement the engine publishes as-is, in contract order: `null` means "not
    // held by this engine", never "zero". The held-frame flag is part of that — without this
    // copy, `explorer.render()` published `null` while the engine had in fact held the frame.
    for (const key of ENGINE_METRIC_KEYS) publishMetric(metricsScratch, published, key)
    metricsScratch.streamingError = streamingError
    metricsScratch.clusters = published.clusters
    metricsScratch.selectedTriangles = published.selectedTriangles
    metricsScratch.residentPages = published.residentPages
    metricsScratch.geometryAllocationBytes = published.geometryAllocationBytes
    metricsScratch.cacheEvictions = published.cacheEvictions ?? stream.evictions
    // A composed total exists only if each of its parts is counted: an engine that does not
    // count its transparent pass leaves the total at `null`, otherwise the opaque pass alone
    // would pass for the exact count of the frame.
    metricsScratch.totalSubmittedTriangles =
      published.totalSubmittedTriangles ??
      (published.submittedTriangles == null || published.transparentSubmittedTriangles == null
        ? null
        : published.submittedTriangles + published.transparentSubmittedTriangles)
    metricsScratch.pageLoads = stream.loaded || loaded
    metricsScratch.pageBytesRead = stream.bytesRead || pageBytesRead
    metricsScratch.pagesRequested = stream.requested
    metricsScratch.pagesLoading = stream.loading
    metricsScratch.cacheHits = stream.hits
    metricsScratch.cacheMisses = stream.misses
    metricsScratch.drawCalls = published.drawCalls
    const work = pageWorkStats()
    metricsScratch.pagesChecked = work.checked
    metricsScratch.pageCheckMs = work.checkMs
    metricsScratch.mathBatch = mathBatchMetrics()
    const integration = pageIntegrationStats()
    metricsScratch.pagesPlannedOffThread = integration.offThread
    metricsScratch.pagePlanMs = integration.planMs
  }
  return { metricsScratch, profiler, fillMetrics }
}
