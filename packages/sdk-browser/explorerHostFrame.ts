import type { AssetScope, ClusterManifest, RuntimeEvent } from '../sdk-core/index.ts';
import type { ExplorerOptions, RenderBackend } from './backendTypes.ts';
import type { createDiagnosticChannel } from './diagnosticChannel.ts';
import { createExplorerDraw } from './explorerDraw.ts';
import type { createExplorerHostState } from './explorerHostState.ts';
import { createExplorerMetrics } from './explorerMetrics.ts';
import type { ExplorerResources, prepareExplorer } from './explorerPrepare.ts';
import { createExplorerRender } from './explorerRender.ts';
import { createExplorerStreaming } from './explorerStreaming.ts';

type Prepared = Awaited<ReturnType<typeof prepareExplorer>>;
type Inputs = {
  options: ExplorerOptions;
  metadata: ClusterManifest;
  prepared: Prepared;
  resources: ExplorerResources;
  host: ReturnType<typeof createExplorerHostState>;
  backends: RenderBackend[];
  scope: AssetScope;
  signal?: AbortSignal;
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>;
  emit: (event: RuntimeEvent) => void;
  diagnose: (phase: string, message: string, context?: Record<string, unknown>) => void;
};

export function createExplorerHostFrame(inputs: Inputs) {
  const {
    options,
    metadata,
    prepared,
    resources,
    host,
    backends,
    scope,
    signal,
    diagnosticChannel,
    emit,
    diagnose,
  } = inputs;
  const { camera, directGpu, pageSources } = prepared;
  const { geometryUrls, pageIdByUrl, streamer } = pageSources;
  const renderer = resources.renderer;
  const { state, baseline, lookAtTarget, compositor, ensureTarget, check, setPose } = host;
  const { metricsScratch, profiler, fillMetrics } = createExplorerMetrics(
    metadata,
    options,
    streamer,
    state.loaded,
    state.pageBytesRead,
    () => ({
      loaded: state.loaded,
      pageBytesRead: state.pageBytesRead,
      streamingError: streaming.error,
    }),
  );
  const streaming = createExplorerStreaming({
    streamer,
    geometryUrls,
    backends,
    signal,
    scope,
    state: () => ({ disposed: state.disposed, measuring: state.measuring, active: state.active }),
    emit,
    diagnose,
  });
  const drawBackend = createExplorerDraw({
    camera,
    geometryUrls,
    streamer,
    streaming,
    directGpu,
    renderer: renderer!,
    baseline,
    scope,
    state: () => ({ measuring: state.measuring }),
    onFallback: (reason) => {
      state.fallbackReason = reason;
      state.active = baseline;
    },
    emit,
    diagnose,
  });
  const render = createExplorerRender({
    check,
    nextFrame: () => ++state.hostFrame,
    state: () => ({
      measuring: state.measuring,
      diagnostic: state.diagnostic,
      comparisonLayout: state.comparisonLayout,
      comparisonPair: state.comparisonPair,
      wipe: state.wipe,
      toggle: state.toggle,
      pairTargetA: state.pairTargetA,
      pairTargetB: state.pairTargetB,
      measurementTarget: state.measurementTarget,
    }),
    getActive: () => state.active,
    setActive: (backend) => {
      state.active = backend;
    },
    setFallbackReason: (reason) => {
      state.fallbackReason = reason;
    },
    setMeasurementTarget: (target) => (state.measurementTarget = target),
    setPairTargets: (left, right) => {
      state.pairTargetA = left;
      state.pairTargetB = right;
    },
    camera,
    lookAtTarget,
    setPose,
    streaming,
    drawBackend,
    ensureTarget,
    directGpu,
    renderer: renderer!,
    backends,
    baseline,
    compositor,
    fillMetrics,
    metricsScratch,
    profiler,
    diagnosticChannel,
    pageIdByUrl,
    streamer,
    scope,
    emit,
    diagnose,
  });
  return { render, profiler, streaming };
}
