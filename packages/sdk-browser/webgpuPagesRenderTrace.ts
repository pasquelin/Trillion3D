import type * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import { cameraPose } from './webgpuPagesStateTiming.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** The CPU path never consults a GPU readback; every trace of it says so with the same reason. */
function cpuSelectionDecision(rt: WebgpuPagesRuntime) {
  return {
    source: 'cpu' as const,
    decision: 'fallback',
    reason: rt.capture.secondaryCamera ? 'surface-capture' : 'gpu-selection-unavailable',
  };
}

const urls = (pages: readonly PageRec[]) => pages.map((page) => page.url);

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
    shown: tracking.traceSet('selection.shown', urls(chosen.shown)),
    wanted: tracking.traceSet('selection.wanted', urls(chosen.wanted ?? chosen.shown)),
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
  camera: THREE.PerspectiveCamera,
  requested: Set<string>,
) {
  const { run, timing, diag } = rt,
    { tracking, bootstrap, slots } = rt.setup;
  diag.traceDiagnostic('frame', 'Snapshot de frame en attente de couverture GPU', () => ({
    backend: 'webgpu-page-raster',
    frame: run.frame,
    submission: run.imageRevision,
    pose: cameraPose(camera),
    source: 'cpu',
    selection: cpuSelectionDecision(rt),
    cpu: timing.cpuSample,
    coverage: {
      loaded: tracking.traceSet('frame.loaded', []),
      wanted: tracking.traceSet('frame.wanted', urls(run.desired)),
      shown: tracking.traceSet('frame.shown', []),
      bootstrap: tracking.traceSet('frame.bootstrap', urls(bootstrap)),
      ready: false,
    },
    budget: {
      slots,
      requested: tracking.traceSet('frame.requested', [...requested]),
      limited: run.coverageBudgetLimited,
    },
    gpuTiming: timing.gpuTiming?.stats() ?? { supported: false, reason: 'not-initialized' },
  }));
}

/** The complete frame snapshot of a CPU-cut image, after its submission. */
export function traceCpuFrame(rt: WebgpuPagesRuntime, camera: THREE.PerspectiveCamera) {
  const { run, timing, diag, blendState } = rt,
    { tracking, bootstrap, bootstrapUrls, slots, frameBudget } = rt.setup;
  if (!diag.traceEnabled) return;
  diag.traceDiagnostic('frame', 'Snapshot complet de la frame WebGPU', () => ({
    backend: 'webgpu-page-raster',
    frame: run.frame,
    submission: run.imageRevision,
    pose: cameraPose(camera),
    source: 'cpu',
    selection: cpuSelectionDecision(rt),
    cpu: timing.cpuSample,
    coverage: {
      loaded: tracking.traceSet('frame.loaded', urls(run.drawn)),
      wanted: tracking.traceSet('frame.wanted', urls(run.desired)),
      shown: tracking.traceSet('frame.shown', urls(run.shown)),
      bootstrap: tracking.traceSet('frame.bootstrap', urls(bootstrap)),
      ready: rt.services.bootstrapState.ready,
    },
    budget: {
      slots,
      requested: tracking.traceSet('frame.requested', [
        ...new Set([...bootstrapUrls, ...urls(run.desired)]),
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
  }));
}
