import * as THREE from 'three';
import {
  type CameraPose,
  type FrameMetrics,
  type RuntimeEvent,
  type AssetScope,
} from '../sdk-core/index.ts';
import { emitExplorerFrameDiagnostic } from './explorerFrameDiagnostic.ts';
import { handleExplorerRenderError } from './explorerRenderFallback.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { createExplorerStreaming } from './explorerStreaming.ts';
import type { createPageStreamer } from './streamingPages.ts';
import type { createDiagnosticChannel } from './diagnosticChannel.ts';
import type { EngineProfiler } from './telemetry.ts';
import type { ComparisonLayout } from './comparison.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';

type State = {
  measuring: boolean;
  diagnostic: DiagnosticMode;
  comparisonLayout: ComparisonLayout;
  comparisonPair: [string, string];
  wipe: number;
  toggle: 0 | 1;
  pairTargetA?: THREE.WebGLRenderTarget;
  pairTargetB?: THREE.WebGLRenderTarget;
  measurementTarget?: THREE.WebGLRenderTarget;
};
type Inputs = {
  check: () => void;
  nextFrame: () => number;
  state: () => State;
  getActive: () => RenderBackend;
  setActive: (backend: RenderBackend) => void;
  setFallbackReason: (reason: string) => void;
  setMeasurementTarget: (target: THREE.WebGLRenderTarget) => THREE.WebGLRenderTarget;
  setPairTargets: (left: THREE.WebGLRenderTarget, right: THREE.WebGLRenderTarget) => void;
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
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>;
  pageIdByUrl: Map<string, number>;
  streamer: ReturnType<typeof createPageStreamer>;
  scope: AssetScope;
  emit: (event: RuntimeEvent) => void;
  diagnose: (phase: string, message: string, context?: Record<string, unknown>) => void;
};

export function createExplorerRender(inputs: Inputs) {
  const {
    check,
    nextFrame,
    state,
    getActive,
    setActive,
    setFallbackReason,
    setMeasurementTarget,
    setPairTargets,
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
    diagnosticChannel,
    pageIdByUrl,
    streamer,
    scope,
    emit,
    diagnose,
  } = inputs;
  const render = (pose?: CameraPose): FrameMetrics => {
    const {
      measuring,
      diagnostic,
      comparisonLayout,
      comparisonPair,
      wipe,
      toggle,
      pairTargetA: initialPairTargetA,
      pairTargetB: initialPairTargetB,
      measurementTarget,
    } = state();
    let pairTargetA = initialPairTargetA,
      pairTargetB = initialPairTargetB;
    check();
    const frameNumber = nextFrame();
    const start = performance.now();
    if (pose) setPose(pose);
    // Drain unique des arrivées, hors de l'image qu'elles auraient allongée.
    const arrivalStart = performance.now();
    streaming.arrivals.drain();
    (getActive() as { cpuStep?: (index: number, ms: number) => void }).cpuStep?.(
      4,
      performance.now() - arrivalStart,
    );
    try {
      if (comparisonLayout === 'single' || measuring)
        drawBackend(
          getActive(),
          measuring && !directGpu ? setMeasurementTarget(ensureTarget(measurementTarget)) : null,
        );
      else {
        const left = backends.find((b) => b.id === comparisonPair[0]) ?? getActive(),
          right = backends.find((b) => b.id === comparisonPair[1]) ?? getActive();
        pairTargetA = ensureTarget(pairTargetA);
        pairTargetB = ensureTarget(pairTargetB);
        setPairTargets(pairTargetA, pairTargetB);
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
        getActive,
        setActive,
        setFallbackReason,
        scope,
        emit,
        diagnose,
      });
    }
    fillMetrics(getActive());
    const frameEnd = performance.now();
    metricsScratch.cpuFrameMs = frameEnd - start;
    if (metricsScratch.drawCalls < 0)
      metricsScratch.drawCalls = ownedRenderer?.info.render.calls ?? 0;
    metricsScratch.triangles =
      metricsScratch.totalSubmittedTriangles ?? ownedRenderer?.info.render.triangles ?? 0;
    profiler.record(metricsScratch);
    emitExplorerFrameDiagnostic({
      diagnosticChannel,
      active: getActive(),
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
