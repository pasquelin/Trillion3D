import { type CameraPose, type FrameMetrics } from '../sdk-core/index.ts';
import { emitExplorerFrameDiagnostic } from './explorerFrameDiagnostic.ts';
import { handleExplorerRenderError } from './explorerRenderFallback.ts';
import { createHostFrameCostAudit } from './frameCostAudit.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { HostCpuProfile } from './hostCpuProfile.ts';
import type { ExplorerHostState } from './explorerHostState.ts';
import type { ExplorerSession } from './explorerSession.ts';
import type { createExplorerStreaming } from './explorerStreaming.ts';
import type { createPageStreamer } from './streamingPages.ts';
import type { EngineProfiler } from './telemetry.ts';
import type { ComparisonLayout } from './comparison.ts';
import type { createFrameComposer } from './explorerCompose.ts';
import type { HostCamera } from './cameraWorld.ts';
import type { WebglRenderTarget } from './webglRenderTarget.ts';
import type { WebglSurface } from './webglSurface.ts';

type Inputs = {
  check: () => void;
  state: ExplorerHostState;
  camera: HostCamera;
  lookAtTarget: { x: number; y: number; z: number };
  setPose: (pose: CameraPose) => void;
  streaming: ReturnType<typeof createExplorerStreaming>;
  drawBackend: (backend: RenderBackend, target: WebglRenderTarget | null) => void;
  ensureTarget: (target?: WebglRenderTarget) => WebglRenderTarget;
  directGpu: boolean;
  webglSurface?: WebglSurface;
  backends: RenderBackend[];
  baseline: RenderBackend;
  compositor?: {
    render: (
      a: WebglRenderTarget,
      b: WebglRenderTarget,
      layout: ComparisonLayout,
      wipe: number,
      toggle: 0 | 1,
    ) => void;
  };
  fillMetrics: (backend: RenderBackend) => void;
  metricsScratch: FrameMetrics;
  profiler: EngineProfiler;
  pageIdByUrl: Map<string, number>;
  streamer: ReturnType<typeof createPageStreamer>;
  compose: ReturnType<typeof createFrameComposer>;
};

export function createExplorerRender(session: ExplorerSession, inputs: Inputs) {
  const { scope, diagnosticChannel, emit, diagnose } = session;
  const {
    check,
    state,
    camera,
    lookAtTarget,
    setPose,
    streaming,
    drawBackend,
    ensureTarget,
    directGpu,
    webglSurface,
    backends,
    baseline,
    compositor,
    fillMetrics,
    metricsScratch,
    profiler,
    pageIdByUrl,
    streamer,
    compose,
  } = inputs;
  const auditFrame = createHostFrameCostAudit();
  const render = (pose?: CameraPose): FrameMetrics => {
    const { measuring, diagnostic, comparisonLayout, comparisonPair, wipe, toggle } = state;
    check();
    const frameNumber = ++state.hostFrame;
    const start = performance.now();
    if (pose) setPose(pose);
    // Single drain of arrivals, outside the frame they would have lengthened.
    const arrivalStart = performance.now();
    streaming.arrivals.drain();
    (state.active as HostCpuProfile).cpuStep?.('arrivalsMs', performance.now() - arrivalStart);
    try {
      if (comparisonLayout === 'single' || measuring) {
        if (measuring && !directGpu)
          state.measurementTarget = ensureTarget(state.measurementTarget);
        drawBackend(state.active, measuring && !directGpu ? state.measurementTarget! : null);
      } else {
        const left = backends.find((b) => b.id === comparisonPair[0]) ?? state.active,
          right = backends.find((b) => b.id === comparisonPair[1]) ?? state.active;
        const pairTargetA = (state.pairTargetA = ensureTarget(state.pairTargetA)),
          pairTargetB = (state.pairTargetB = ensureTarget(state.pairTargetB));
        drawBackend(left, pairTargetA);
        drawBackend(right, pairTargetB);
        compositor!.render(pairTargetA, pairTargetB, comparisonLayout, wipe, toggle);
      }
    } catch (error) {
      handleExplorerRenderError(error, {
        measuring,
        diagnostic,
        webglSurface,
        camera,
        baseline,
        state,
        scope,
        emit,
        diagnose,
        compose,
      });
    }
    fillMetrics(state.active);
    const frameEnd = performance.now();
    metricsScratch.cpuFrameMs = frameEnd - start;
    // Submitted triangles of this frame: those the engine counted, and only those. `null` when
    // it has not counted them — a zero published here would read as an empty frame, and that is
    // what the contract forbids. Draw calls follow the same rule, in `fillMetrics`.
    metricsScratch.triangles = metricsScratch.totalSubmittedTriangles ?? null;
    auditFrame(state.active.id, frameNumber, metricsScratch);
    profiler.record(metricsScratch);
    emitExplorerFrameDiagnostic({
      diagnosticChannel,
      active: state.active,
      camera,
      lookAtTarget,
      metricsScratch,
      pageIdByUrl,
      streamer,
      measuring,
      scope,
      frameNumber,
      diagnose,
    });
    return metricsScratch;
  };
  return render;
}
