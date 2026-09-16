import { pageDecodeStats } from './pageDecodeHost.ts';
import { EngineProfiler } from './telemetry.ts';
import type { FrameMetrics, ClusterManifest } from '../sdk-core/index.ts';
import type { ExplorerOptions, RenderBackend } from './backendTypes.ts';
import { BACKEND_METRIC_KEYS } from './backendMetricKeys.ts';
import type { createPageStreamer } from './streamingPages.ts';

type State = () => { loaded: number; pageBytesRead: number; streamingError: string | null };

/** Recopie une mesure du moteur dans le relevé de l'hôte : `null` quand ce moteur ne la tient pas. */
function publishMetric<K extends (typeof BACKEND_METRIC_KEYS)[number]>(
  into: FrameMetrics,
  from: FrameMetrics,
  key: K,
) {
  into[key] = (from[key] ?? null) as FrameMetrics[K];
}

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
    cpuSelectNodesTested: null,
    cpuSubmitMs: null,
    gpuMs: null,
    drawCalls: 0,
    triangles: null,
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
    drawnTriangles: null,
    lightsActive: null,
    shadowsUpdated: null,
    shadowFacesDrawn: null,
    shadowDrawCalls: null,
    shadowPagesDrawn: null,
    shadowPagesPending: null,
    shadowWaitMs: null,
    gpuLightListsMs: null,
    gpuShadowsMs: null,
    gpuLightingMs: null,
    textureInFlight: null,
    textureSlicesUploaded: null,
    textureBytesLastFrame: null,
    textureLevelsUploaded: null,
    textureAtlasBytesCalculated: null,
    textureAtlasClassBytesCalculated: null,
    textureAtlasClassesUsed: null,
    pagesDecodedOffThread: null,
    pagesDecodedWasm: null,
    pageDecodeMs: null,
  };
  const profiler = new EngineProfiler();
  profiler.setMetadata(metadata);
  if (options.logInterval && options.logInterval > 0) profiler.startAutoLog(options.logInterval);
  const fillMetrics = (backend: RenderBackend) => {
    const { loaded, pageBytesRead, streamingError } = state();
    const backendMetrics = backend.metrics() as FrameMetrics;
    const stream = streamer.stats();
    // Chaque mesure que le moteur publie telle quelle, dans l'ordre du contrat : `null` dit « non
    // tenue par ce moteur », jamais « zéro ». Le témoin d'image tenue en fait partie — sans cette
    // recopie, `explorer.render()` publiait `null` alors que le moteur avait bien tenu l'image.
    for (const key of BACKEND_METRIC_KEYS) publishMetric(metricsScratch, backendMetrics, key);
    metricsScratch.streamingError = streamingError;
    metricsScratch.clusters = backendMetrics.clusters;
    metricsScratch.selectedTriangles = backendMetrics.selectedTriangles;
    metricsScratch.residentPages = backendMetrics.residentPages;
    metricsScratch.geometryAllocationBytes = backendMetrics.geometryAllocationBytes;
    metricsScratch.cacheEvictions = backendMetrics.cacheEvictions ?? stream.evictions;
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
    metricsScratch.drawCalls =
      typeof backendMetrics.drawCalls === 'number' ? backendMetrics.drawCalls : -1;
    const decode = pageDecodeStats();
    metricsScratch.pagesDecodedOffThread = decode.offThread;
    metricsScratch.pagesDecodedWasm = decode.wasm;
    metricsScratch.pageDecodeMs = decode.decodeMs;
  };
  return { metricsScratch, profiler, fillMetrics };
}
