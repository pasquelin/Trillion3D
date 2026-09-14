import { EngineProfiler } from './telemetry.ts';
import type { FrameMetrics, ClusterManifest } from '../sdk-core/index.ts';
import type { ExplorerOptions, RenderBackend } from './backendTypes.ts';
import type { createPageStreamer } from './streamingPages.ts';

type State = () => { loaded: number; pageBytesRead: number; streamingError: string | null };

export function createExplorerMetrics(
  metadata: ClusterManifest,
  options: ExplorerOptions,
  streamer: ReturnType<typeof createPageStreamer>,
  loaded: number,
  pageBytesRead: number,
  state: State,
) {
  const metricsScratch: FrameMetrics = {
    rafIntervalMs: null,
    cpuFrameMs: 0,
    cpuSelectMs: null,
    cpuSubmitMs: null,
    gpuMs: null,
    drawCalls: 0,
    triangles: 0,
    clusters: null,
    selectedTriangles: null,
    residentPages: null,
    geometryAllocationBytes: null,
    vramBytes: null,
    pageLoads: loaded,
    pageBytesRead,
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
    uncoveredTriangles: null,
  };
  const profiler = new EngineProfiler();
  profiler.setMetadata(metadata);
  if (options.logInterval && options.logInterval > 0) profiler.startAutoLog(options.logInterval);
  const fillMetrics = (backend: RenderBackend) => {
    const { loaded, pageBytesRead, streamingError } = state();
    const backendMetrics = backend.metrics() as FrameMetrics;
    const stream = streamer.stats();
    metricsScratch.coverageReady = backendMetrics.coverageReady ?? null;
    metricsScratch.coverageBudgetLimited = backendMetrics.coverageBudgetLimited ?? null;
    metricsScratch.streamingError = streamingError;
    metricsScratch.clusters = backendMetrics.clusters;
    metricsScratch.selectedTriangles = backendMetrics.selectedTriangles;
    metricsScratch.uncoveredTriangles = backendMetrics.uncoveredTriangles ?? null;
    metricsScratch.residentPages = backendMetrics.residentPages;
    metricsScratch.pagesDetached = backendMetrics.pagesDetached ?? null;
    metricsScratch.cacheEvictions = backendMetrics.cacheEvictions ?? stream.evictions;
    metricsScratch.geometryAllocationBytes = backendMetrics.geometryAllocationBytes;
    metricsScratch.frustumRejected = backendMetrics.frustumRejected ?? null;
    metricsScratch.hizTestedClusters = backendMetrics.hizTestedClusters ?? null;
    metricsScratch.hizRejectedClusters = backendMetrics.hizRejectedClusters ?? null;
    metricsScratch.hizOversizedClusters = backendMetrics.hizOversizedClusters ?? null;
    metricsScratch.hizTestedTriangles = backendMetrics.hizTestedTriangles ?? null;
    metricsScratch.hizRejectedTriangles = backendMetrics.hizRejectedTriangles ?? null;
    metricsScratch.hizOversizedTriangles = backendMetrics.hizOversizedTriangles ?? null;
    metricsScratch.hizCountedFrame = backendMetrics.hizCountedFrame ?? null;
    metricsScratch.lodLevel = backendMetrics.lodLevel ?? null;
    metricsScratch.submittedTriangles = backendMetrics.submittedTriangles ?? null;
    metricsScratch.transparentMeshes = backendMetrics.transparentMeshes ?? null;
    metricsScratch.transparentFrustumRejected = backendMetrics.transparentFrustumRejected ?? null;
    metricsScratch.transparentDrawCalls = backendMetrics.transparentDrawCalls ?? null;
    metricsScratch.transparentSubmittedTriangles =
      backendMetrics.transparentSubmittedTriangles ?? null;
    metricsScratch.totalSubmittedTriangles =
      backendMetrics.totalSubmittedTriangles ??
      (backendMetrics.submittedTriangles == null
        ? null
        : backendMetrics.submittedTriangles + (backendMetrics.transparentSubmittedTriangles ?? 0));
    metricsScratch.pageLoads = stream.loaded || loaded;
    metricsScratch.pageBytesRead = stream.bytesRead || pageBytesRead;
    metricsScratch.pagesRequested = stream.requested;
    metricsScratch.pagesLoading = stream.loading;
    metricsScratch.cacheHits = stream.hits;
    metricsScratch.cacheMisses = stream.misses;
    metricsScratch.cpuSelectMs = backendMetrics.cpuSelectMs ?? null;
    metricsScratch.cpuSubmitMs = backendMetrics.cpuSubmitMs ?? null;
    metricsScratch.gpuMs = backendMetrics.gpuMs ?? null;
    metricsScratch.gpuPassMs = backendMetrics.gpuPassMs ?? null;
    metricsScratch.gpuFrameMs = backendMetrics.gpuFrameMs ?? null;
    metricsScratch.gpuHostGapMs = backendMetrics.gpuHostGapMs ?? null;
    metricsScratch.vramBytes = backendMetrics.vramBytes ?? null;
    metricsScratch.drawCalls =
      typeof backendMetrics.drawCalls === 'number' ? backendMetrics.drawCalls : -1;
    metricsScratch.textureUploaded = backendMetrics.textureUploaded ?? null;
    metricsScratch.texturePending = backendMetrics.texturePending ?? null;
    metricsScratch.textureSkipped = backendMetrics.textureSkipped ?? null;
  };
  return { metricsScratch, profiler, fillMetrics };
}
