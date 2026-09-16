import type { PageRec } from './pageSelection.ts';
import { urlsOf } from './webgpuPagesHelpers.ts';
import { enginePose, type EngineCamera } from './cameraWorld.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Every full frame snapshot starts from the same identity: backend, frame, submission, pose and
 *  the CPU sample; callers append only what their selection path knows. */
export function frameTraceSnapshot<T extends object>(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  selection: { source: 'gpu' | 'cpu'; decision: string },
  rest: T,
) {
  return {
    backend: 'webgpu-page-raster',
    frame: rt.run.frame,
    submission: rt.run.imageRevision,
    pose: enginePose(cam),
    source: selection.source,
    selection,
    cpu: rt.timing.cpuSample,
    ...rest,
  };
}

/** The CPU path never consults a GPU readback; every trace of it says so with the same reason. */
function cpuSelectionDecision(rt: WebgpuPagesRuntime) {
  return {
    source: 'cpu' as const,
    decision: 'fallback',
    reason: rt.capture.secondaryCamera ? 'surface-capture' : 'gpu-selection-unavailable',
  };
}

export function traceCpuSelection(
  rt: WebgpuPagesRuntime,
  chosen: {
    shown: PageRec[];
    wanted?: PageRec[];
    visible: number;
    selectedTriangles: number;
    frustumRejected: number;
    lodLevel: number;
  },
  elapsedMs: number,
) {
  const { run, diag } = rt,
    { tracking } = rt.setup;
  diag.traceDiagnostic('cpu-selection', 'Sélection CPU de référence', () => ({
    frame: run.frame,
    submission: run.imageRevision,
    scope: 'cpu/selectVisiblePages',
    elapsedMs,
    shown: tracking.traceSet('selection.shown', urlsOf(chosen.shown)),
    wanted: tracking.traceSet('selection.wanted', urlsOf(chosen.wanted ?? chosen.shown)),
    visible: chosen.visible,
    selectedTriangles: chosen.selectedTriangles,
    frustumRejected: chosen.frustumRejected,
    lodLevel: chosen.lodLevel,
    reason: cpuSelectionDecision(rt).reason,
  }));
}

/** The frame snapshot of an image that could not draw: the bootstrap cover is not resident yet. */
export function traceCpuFrameWaiting(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  requested: Set<string>,
) {
  const { run, timing, diag } = rt,
    { tracking, bootstrap, slots } = rt.setup;
  diag.traceDiagnostic('frame', 'Snapshot de frame en attente de couverture GPU', () =>
    frameTraceSnapshot(rt, cam, cpuSelectionDecision(rt), {
      coverage: {
        loaded: tracking.traceSet('frame.loaded', []),
        wanted: tracking.traceSet('frame.wanted', urlsOf(run.desired)),
        shown: tracking.traceSet('frame.shown', []),
        bootstrap: tracking.traceSet('frame.bootstrap', urlsOf(bootstrap)),
        ready: false,
      },
      budget: {
        slots,
        requested: tracking.traceSet('frame.requested', [...requested]),
        limited: run.coverageBudgetLimited,
      },
      gpuTiming: timing.gpuTiming?.stats() ?? { supported: false, reason: 'not-initialized' },
    }),
  );
}

/** The complete frame snapshot of a CPU-cut image, after its submission. */
export function traceCpuFrame(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const { run, timing, diag, blendState } = rt,
    { tracking, bootstrap, bootstrapUrls, slots, frameBudget } = rt.setup;
  if (!diag.traceEnabled) return;
  diag.traceDiagnostic('frame', 'Snapshot complet de la frame WebGPU', () =>
    frameTraceSnapshot(rt, cam, cpuSelectionDecision(rt), {
      coverage: {
        loaded: tracking.traceSet('frame.loaded', urlsOf(run.drawn)),
        wanted: tracking.traceSet('frame.wanted', urlsOf(run.desired)),
        shown: tracking.traceSet('frame.shown', urlsOf(run.shown)),
        bootstrap: tracking.traceSet('frame.bootstrap', urlsOf(bootstrap)),
        ready: rt.services.bootstrapState.ready,
      },
      budget: {
        slots,
        requested: tracking.traceSet('frame.requested', [
          ...new Set([...bootstrapUrls, ...urlsOf(run.desired)]),
        ]),
        limited: run.coverageBudgetLimited,
        frameBytes: frameBudget,
      },
      gpuTiming: timing.gpuTiming?.stats() ?? { supported: false, reason: 'not-initialized' },
      transparent: {
        candidates: blendState.blendGpu.length,
        visibleMeshes: blendState.visibleBlend.length,
        frustumRejected: run.blendFrustumRejected,
        drawCalls: run.blendDrawCalls,
        submittedTriangles: run.blendSubmittedTriangles,
      },
      drawCalls: run.gpuDrawCalls,
    }),
  );
}
