import type * as THREE from 'three';
import { cameraPose, publishCpuProfile } from './webgpuPagesStateTiming.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

export type GpuCutMarks = {
  cpuStart: number;
  lightsEnd: number;
  adoptEnd: number;
  transparentSelectEnd: number;
  admissionEnd: number;
  queueEnd: number;
  rowsEnd: number;
  residencyUploadEnd: number;
  selectionEnd: number;
  encodeStart: number;
  cpuEnd: number;
};

/** Files the image's CPU steps into the profile and the sample the progress diagnostic reports. */
export function recordGpuCutTiming(rt: WebgpuPagesRuntime, m: GpuCutMarks) {
  const { timing, run } = rt;
  const submitMs = m.cpuEnd - m.encodeStart;
  timing.lastSubmitMs = submitMs;
  const steps = timing.cpuProfile.row;
  steps[0] = m.adoptEnd - m.lightsEnd;
  steps[1] = m.transparentSelectEnd - m.adoptEnd;
  steps[2] = m.admissionEnd - m.transparentSelectEnd;
  steps[3] = m.queueEnd - m.admissionEnd;
  steps[4] = m.rowsEnd - m.queueEnd;
  steps[5] = m.residencyUploadEnd - m.rowsEnd;
  steps[6] = m.selectionEnd - m.residencyUploadEnd;
  steps[7] = timing.lastProjectMs;
  steps[8] = timing.lastPartitionMs;
  steps[9] = timing.lastItemsMs;
  steps[10] = submitMs - timing.lastProjectMs - timing.lastPartitionMs - timing.lastItemsMs;
  steps[11] = submitMs;
  steps[12] = m.cpuEnd - m.cpuStart;
  timing.cpuProfile.record(run.frame, m.cpuEnd - m.cpuStart);
  timing.cpuSample = {
    version: 1,
    frame: run.frame,
    submission: run.imageRevision,
    scope: 'backend-render-call',
    totalMs: m.cpuEnd - m.cpuStart,
    lightsMs: m.lightsEnd - m.cpuStart,
    selectionMs: m.selectionEnd - m.lightsEnd,
    residencyScheduleAndTargetsMs: m.encodeStart - m.selectionEnd,
    encodeSubmitMs: submitMs,
    transparentEncodeMs: timing.transparentEncodeMs,
    transparentIncludedIn: 'encodeSubmitMs',
    asyncResidencyWaitMs: null,
  };
  publishCpuProfile(timing, run, rt.diag);
}

export function traceGpuCutWaiting(rt: WebgpuPagesRuntime) {
  rt.diag.traceDiagnostic('frame', 'Frame en attente de couverture GPU', {
    backend: 'webgpu-page-raster',
    frame: rt.run.frame,
    submission: rt.run.imageRevision,
    source: 'gpu',
    coverage: { ready: false },
    selectedTriangles: null,
    submittedTriangles: null,
  });
}

/** The per-frame trace records of a GPU-cut image; both are built lazily and only when tracing. */
export function traceGpuCutFrame(rt: WebgpuPagesRuntime, camera: THREE.PerspectiveCamera) {
  const { run, timing, diag } = rt,
    { rows } = rt.layout,
    { tracking, slots } = rt.setup;
  if (!diag.traceEnabled) return;
  diag.traceDiagnostic(
    'gpu-selection-current-frame',
    'Sélection GPU consommée par le dessin',
    () => ({
      frame: run.frame,
      submission: run.imageRevision,
      source: 'gpu',
      decision: 'current-frame-mask',
      residentCandidates: rows.candidateCount,
      readbackPurpose: 'streaming-and-metrics',
      metricsReady: run.gpuMetricsReady,
    }),
  );
  diag.traceDiagnostic('frame', 'Snapshot complet de la frame WebGPU', () => ({
    backend: 'webgpu-page-raster',
    frame: run.frame,
    submission: run.imageRevision,
    pose: cameraPose(camera),
    source: 'gpu',
    selection: { source: 'gpu', decision: 'current-frame-mask' },
    cpu: timing.cpuSample,
    coverage: {
      loaded: tracking.traceSet(
        'frame.loaded',
        rows.packedRecs.slice(0, rows.packedCount).map((page) => page!.url),
      ),
      wanted: tracking.traceSet(
        'frame.wanted',
        run.desired.map((page) => page.url),
      ),
      shown: run.gpuMetricsReady
        ? tracking.traceSet(
            'frame.shown',
            run.shown.map((page) => page.url),
          )
        : null,
      ready: rt.services.bootstrapState.ready,
    },
    budget: { slots, limited: run.coverageBudgetLimited },
    selectedTriangles: run.selectedTriangles,
    uncoveredTriangles: run.uncoveredTriangles,
    submittedTriangles: run.gpuMetricsReady ? run.submittedTriangles : null,
    drawCalls: run.gpuDrawCalls,
  }));
}
