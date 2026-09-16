import type { EngineCamera } from './cameraWorld.ts';
import { CPU_STEP } from './webgpuPagesCpuSteps.ts';
import { frameTraceSnapshot } from './webgpuPagesRenderTrace.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Files the image's CPU steps into the profile and the sample the progress diagnostic reports. */
export function recordGpuCutTiming(rt: WebgpuPagesRuntime) {
  const { timing, run } = rt,
    m = timing.marks;
  const submitMs = m.cpuEnd - m.encodeStart;
  timing.lastSubmitMs = submitMs;
  const steps = timing.cpuProfile.row;
  steps[CPU_STEP.worldMs] = m.blendStart - m.preStart;
  steps[CPU_STEP.blendWorldMs] = m.cpuStart - m.blendStart;
  steps[CPU_STEP.lightsMs] = m.lightsEnd - m.cpuStart;
  steps[CPU_STEP.adoptCutMs] = m.adoptEnd - m.lightsEnd;
  steps[CPU_STEP.transparentSelectMs] = timing.transparentSelectMs;
  steps[CPU_STEP.transparentPrepareMs] = timing.transparentPrepareMs;
  steps[CPU_STEP.transparentDrawMs] = timing.transparentDrawMs;
  steps[CPU_STEP.transparentEncodeMs] = timing.transparentEncodeMs;
  steps[CPU_STEP.admissionMs] = m.admissionEnd - m.transparentSelectEnd;
  steps[CPU_STEP.residencyQueueMs] = m.queueEnd - m.admissionEnd;
  steps[CPU_STEP.syncRowsMs] = m.rowsEnd - m.queueEnd;
  steps[CPU_STEP.residencyUploadMs] = m.residencyUploadEnd - m.rowsEnd;
  steps[CPU_STEP.selectionDispatchMs] = m.selectionEnd - m.residencyUploadEnd;
  steps[CPU_STEP.partitionMs] = timing.lastPartitionMs;
  // L'encodage restant exclut la soumission elle-même : les deux étapes ne se recouvrent jamais.
  steps[CPU_STEP.encodeRestMs] = Math.max(
    0,
    submitMs -
      timing.lastPartitionMs -
      timing.transparentSelectMs -
      timing.transparentEncodeMs -
      timing.lastQueueSubmitMs,
  );
  steps[CPU_STEP.queueSubmitMs] = timing.lastQueueSubmitMs;
  steps[CPU_STEP.encodeSubmitMs] = submitMs;
  // Le total de la ligne couvre l'image entière du moteur, préparation comprise : la borne
  // `cpuStart` n'ouvre que la partie que les lots précédents chronométraient.
  steps[CPU_STEP.totalMs] = m.cpuEnd - m.preStart;
  timing.rowFilled = true;
  timing.cpuSample = {
    version: 1,
    frame: run.frame,
    submission: run.imageRevision,
    scope: 'backend-render-call',
    totalMs: m.cpuEnd - m.preStart,
    lightsMs: m.lightsEnd - m.cpuStart,
    selectionMs: m.selectionEnd - m.lightsEnd,
    residencyScheduleAndTargetsMs: m.encodeStart - m.selectionEnd,
    encodeSubmitMs: submitMs,
    transparentEncodeMs: timing.transparentEncodeMs,
    transparentIncludedIn: 'encodeSubmitMs',
    asyncResidencyWaitMs: null,
    /** Pages the residency path had to touch: the cut's difference, not its size. */
    residencyPagesEntered: run.pagesEntered,
    residencyPagesExited: run.pagesExited,
  };
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
export function traceGpuCutFrame(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const { run, diag } = rt,
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
  diag.traceDiagnostic('frame', 'Snapshot complet de la frame WebGPU', () =>
    frameTraceSnapshot(
      rt,
      cam,
      { source: 'gpu', decision: 'current-frame-mask' },
      {
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
      },
    ),
  );
}
