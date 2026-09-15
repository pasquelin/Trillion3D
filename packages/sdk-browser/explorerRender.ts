import * as THREE from 'three';
import { type CameraPose, type FrameMetrics } from '../sdk-core/index.ts';
import { emitExplorerFrameDiagnostic } from './explorerFrameDiagnostic.ts';
import { handleExplorerRenderError } from './explorerRenderFallback.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { HostCpuProfile } from './hostCpuProfile.ts';
import type { ExplorerHostState } from './explorerHostState.ts';
import type { ExplorerSession } from './explorerSession.ts';
import type { createExplorerStreaming } from './explorerStreaming.ts';
import type { createPageStreamer } from './streamingPages.ts';
import type { EngineProfiler } from './telemetry.ts';
import type { ComparisonLayout } from './comparison.ts';

type Inputs = {
  check: () => void;
  state: ExplorerHostState;
  camera: THREE.PerspectiveCamera;
  lookAtTarget: THREE.Vector3;
  setPose: (pose: CameraPose) => void;
  streaming: ReturnType<typeof createExplorerStreaming>;
  drawBackend: (backend: RenderBackend, target: THREE.WebGLRenderTarget | null) => void;
  ensureTarget: (target?: THREE.WebGLRenderTarget) => THREE.WebGLRenderTarget;
  directGpu: boolean;
  renderer: THREE.WebGLRenderer;
  backends: RenderBackend[];
  baseline: RenderBackend;
  compositor?: {
    render: (
      a: THREE.Texture,
      b: THREE.Texture,
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
    renderer: ownedRenderer,
    backends,
    baseline,
    compositor,
    fillMetrics,
    metricsScratch,
    profiler,
    pageIdByUrl,
    streamer,
  } = inputs;
  const render = (pose?: CameraPose): FrameMetrics => {
    const { measuring, diagnostic, comparisonLayout, comparisonPair, wipe, toggle } = state;
    check();
    const frameNumber = ++state.hostFrame;
    const start = performance.now();
    if (pose) setPose(pose);
    // Drain unique des arrivées, hors de l'image qu'elles auraient allongée.
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
        compositor!.render(
          pairTargetA.texture,
          pairTargetB.texture,
          comparisonLayout,
          wipe,
          toggle,
        );
      }
    } catch (error) {
      handleExplorerRenderError(error, {
        measuring,
        diagnostic,
        renderer: ownedRenderer,
        camera,
        baseline,
        state,
        scope,
        emit,
        diagnose,
      });
    }
    fillMetrics(state.active);
    const frameEnd = performance.now();
    metricsScratch.cpuFrameMs = frameEnd - start;
    if (metricsScratch.drawCalls < 0)
      metricsScratch.drawCalls = ownedRenderer?.info.render.calls ?? 0;
    metricsScratch.triangles =
      metricsScratch.totalSubmittedTriangles ?? ownedRenderer?.info.render.triangles ?? 0;
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
