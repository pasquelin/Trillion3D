import type { RenderBackend } from './backendTypes.ts';
import { createExplorerCapture } from './explorerCapture.ts';
import { createExplorerCaptureView } from './explorerCaptureView.ts';
import { createExplorerHostState } from './explorerHostState.ts';
import { createExplorerHostFrame } from './explorerHostFrame.ts';
import { createExplorerLifecycle } from './explorerLifecycle.ts';
import type { ExplorerResources, prepareExplorer } from './explorerPrepare.ts';
import type { ExplorerSession } from './explorerSession.ts';

type Prepared = Awaited<ReturnType<typeof prepareExplorer>>;
type Inputs = {
  prepared: Prepared;
  resources: ExplorerResources;
  backends: RenderBackend[];
};

export function createExplorerHostRuntime(session: ExplorerSession, inputs: Inputs) {
  const { canvas, options, metadata, scope, signal, diagnose } = session;
  const { prepared, resources, backends } = inputs;
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
  const { gpuDevice, webglSurface } = resources;
  const host = createExplorerHostState(prepared, options, backends, canvas, webglSurface, signal);
  const {
    state,
    beautyMaterials,
    overlays,
    hostedControls,
    lookAtTarget,
    compose,
    disposeComposition,
    check,
    setPose,
  } = host;
  const { render, profiler, streaming } = createExplorerHostFrame(session, {
    prepared,
    host,
    backends,
  });
  const capture = createExplorerCapture({
    canvas,
    camera,
    context: webglSurface?.context,
    options,
    directGpu,
    state,
    check,
    diagnose,
    compose,
  });
  const captureView = createExplorerCaptureView({
    camera,
    context: webglSurface?.context,
    active: () => state.active,
    check,
    compose,
  });
  const { dispose, flush, awaitPages } = createExplorerLifecycle(session, {
    check,
    state,
    gpuDevice,
    profiler,
    hostedControls,
    disposeComposition,
    streamer,
    streaming,
    overlays,
    backends,
    source,
    webglSurface,
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
    async pendingFrame() {
      const loading = streaming.promise;
      await loading;
      if (state.disposed) return false;
      const pending = await state.active.pendingFrame?.();
      return !!loading || !!streaming.promise || streaming.arrivals.pending > 0 || !!pending;
    },
    capture,
    captureView,
    gpuDevice,
    dispose,
    setPose,
    awaitPages,
    flush,
    check,
    scope,
    directGpu,
    webglSurface,
    viewport,
    context,
    homeOffset,
    lookAtTarget,
    radius,
    hostedControls,
    beautyMaterials,
    overlays,
    profiler,
    state,
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

/** What the host runtime hands the public API: one alias types both ends. */
export type ExplorerRuntimeSurface = ReturnType<typeof createExplorerHostRuntime>;
