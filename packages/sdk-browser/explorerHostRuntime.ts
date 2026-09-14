import type { AssetScope, ClusterManifest, RuntimeEvent } from '../sdk-core/index.ts';
import type { ExplorerOptions, RenderBackend } from './backendTypes.ts';
import type { createDiagnosticChannel } from './diagnosticChannel.ts';
import { createExplorerCapture } from './explorerCapture.ts';
import { createExplorerHostState } from './explorerHostState.ts';
import { createExplorerHostFrame } from './explorerHostFrame.ts';
import { createExplorerLifecycle } from './explorerLifecycle.ts';
import type { ExplorerResources, prepareExplorer } from './explorerPrepare.ts';

type Prepared = Awaited<ReturnType<typeof prepareExplorer>>;
type Inputs = {
  canvas: HTMLCanvasElement;
  options: ExplorerOptions;
  metadata: ClusterManifest;
  prepared: Prepared;
  resources: ExplorerResources;
  backends: RenderBackend[];
  scope: AssetScope;
  signal?: AbortSignal;
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>;
  emit: (event: RuntimeEvent) => void;
  diagnose: (phase: string, message: string, context?: Record<string, unknown>) => void;
};

export function createExplorerHostRuntime(inputs: Inputs) {
  const {
    canvas,
    options,
    metadata,
    prepared,
    resources,
    backends,
    scope,
    signal,
    diagnosticChannel,
    emit,
    diagnose,
  } = inputs;
  const {
    source,
    pageSources,
    directGpu,
    viewport,
    context,
    camera,
    center,
    bounds,
    radius,
    homeOffset,
  } = prepared;
  const { geometryUrls, streamer } = pageSources;
  const renderer = resources.renderer;
  const gpuDevice = resources.gpuDevice;
  const host = createExplorerHostState(prepared, options, backends, canvas, renderer, signal);
  const {
    state,
    beautyMaterials,
    overlays,
    hostedControls,
    lookAtTarget,
    compositor,
    check,
    setPose,
  } = host;
  const { render, profiler, streaming } = createExplorerHostFrame({
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
  });
  const capture = createExplorerCapture({
    canvas,
    camera,
    renderer: renderer!,
    options,
    directGpu,
    state: () => ({ active: state.active }),
    check,
    diagnose,
  });
  const { dispose, flush, awaitPages } = createExplorerLifecycle({
    check,
    state: () => ({
      disposed: state.disposed,
      active: state.active,
      left: state.pairTargetA,
      right: state.pairTargetB,
      gpuDevice,
    }),
    setDisposed: () => {
      state.disposed = true;
    },
    setPageStats: (loaded, bytesRead) => {
      state.loaded = loaded;
      state.pageBytesRead = bytesRead;
    },
    scope,
    diagnose,
    diagnosticChannel,
    profiler,
    hostedControls,
    disposeTargets: () => {
      state.measurementTarget?.dispose();
      state.measurementTarget = undefined;
    },
    compositor,
    streamer,
    streaming,
    overlays,
    backends,
    source,
    renderer,
    camera,
    geometryUrls,
  });
  return {
    options,
    camera,
    center,
    bounds,
    metadata,
    backends,
    canvas,
    render,
    capture,
    dispose,
    setPose,
    awaitPages,
    flush,
    check,
    scope,
    directGpu,
    renderer: renderer!,
    viewport,
    context,
    homeOffset,
    lookAtTarget,
    radius,
    hostedControls,
    beautyMaterials,
    overlays,
    profiler,
    state: () => ({
      active: state.active,
      fallbackReason: state.fallbackReason,
      diagnostic: state.diagnostic,
      comparisonLayout: state.comparisonLayout,
      comparisonPair: state.comparisonPair,
      wipe: state.wipe,
      toggle: state.toggle,
      disposed: state.disposed,
      measurementTarget: state.measurementTarget,
      pairTargetA: state.pairTargetA,
      pairTargetB: state.pairTargetB,
    }),
    setActive: (backend: RenderBackend) => {
      state.active = backend;
    },
    setDiagnostic: (mode: typeof state.diagnostic) => {
      state.diagnostic = mode;
    },
    setCapturingSurface: (value: boolean) => {
      state.capturingSurface = value;
    },
    setMeasuring: (value: boolean) => {
      state.measuring = value;
    },
    setComparison: (
      layout: typeof state.comparisonLayout,
      pair?: [string, string],
      wipe?: number,
      toggle?: 0 | 1,
    ) => {
      state.comparisonLayout = layout;
      if (pair) state.comparisonPair = pair;
      if (wipe !== undefined) state.wipe = wipe;
      if (toggle !== undefined) state.toggle = toggle;
    },
  };
}
