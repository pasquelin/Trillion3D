import { type CameraPose, type FrameMetrics } from '../../../../sdk-core/src/index.ts';
import { emitExplorerFrameDiagnostic } from '../diagnostic/frameDiagnostic.ts';
import { handleExplorerRenderError } from './renderFallback.ts';
import { createHostFrameCostAudit } from '../../frame/costAudit.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { HostCpuProfile } from '../../host/cpuProfile.ts';
import type { BoundTarget, ExplorerHostState } from './hostState.ts';
import type { WebglRenderTarget } from '../../webgl/core/renderTarget.ts';
import type { ExplorerSession } from '../session/session.ts';
import type { createExplorerStreaming } from '../scene/streaming.ts';
import type { createPageStreamer } from '../../streaming/pages.ts';
import type { EngineProfiler } from '../../diagnostic/telemetry.ts';
import type { ComparisonLayout } from '../../measurement/comparison.ts';
import type { createFrameComposer } from './compose.ts';
import type { HostCamera } from '../../camera/world.ts';
import type { WebglSurface } from '../../webgl/core/surface.ts';

type Inputs = {
  check: () => void;
  state: ExplorerHostState;
  camera: HostCamera;
  lookAtTarget: { x: number; y: number; z: number };
  setPose: (pose: CameraPose) => void;
  streaming: ReturnType<typeof createExplorerStreaming>;
  drawBackend: (backend: RenderBackend, target: WebglRenderTarget | null) => void;
  ensureTarget: (target?: BoundTarget) => BoundTarget;
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

/** The `ExplorerSession` fields the frame render actually reads — narrower than the full
 *  session so a caller can supply a session slice instead of every field it never touches. */
export type ExplorerRenderSession = Pick<
  ExplorerSession,
  'scope' | 'diagnosticChannel' | 'emit' | 'diagnose'
>;

export function createExplorerRender(session: ExplorerRenderSession, inputs: Inputs) {
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
  /** The live target, or the loss the frame will report: a dead one has no framebuffer. */
  const live = (target: BoundTarget) => {
    const current = target.current();
    if (!current) throw new Error('CONTEXT_LOST');
    return current;
  };
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
        let target: WebglRenderTarget | null = null;
        if (measuring && !directGpu)
          target = live((state.measurementTarget = ensureTarget(state.measurementTarget)));
        drawBackend(state.active, target);
      } else {
        const left = backends.find((b) => b.id === comparisonPair[0]) ?? state.active,
          right = backends.find((b) => b.id === comparisonPair[1]) ?? state.active;
        const pairTargetA = live((state.pairTargetA = ensureTarget(state.pairTargetA))),
          pairTargetB = live((state.pairTargetB = ensureTarget(state.pairTargetB)));
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
