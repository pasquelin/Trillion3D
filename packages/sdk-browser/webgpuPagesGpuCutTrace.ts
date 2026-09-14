import type * as THREE from 'three';
import { CPU_STEP_STAGES, publishCpuProfile } from './webgpuPagesStateTiming.ts';
import { frameTraceSnapshot } from './webgpuPagesRenderTrace.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Dépose les bornes processeur de l'image dans le profil public par étape, quand il est monté. */
function recordStages(rt: WebgpuPagesRuntime) {
  const { timing, lights } = rt,
    stages = timing.stages;
  if (!stages) return;
  const row = timing.cpuProfile.row;
  stages.frameCpu((add) => {
    for (let i = 0; i < CPU_STEP_STAGES.length; i++) {
      const stage = CPU_STEP_STAGES[i];
      if (stage) add(stage, row[i]);
    }
  });
  // Ce que la passe d'ombres a réellement redessiné : des compteurs, jamais des durées.
  stages.setCounts('shadows', {
    lampesAOmbre: lights.shadowsUpdated,
    facesRedessinees: lights.shadowFaces,
    appelsDeDessin: lights.shadowDrawCalls,
  });
  stages.setCounts('lightLists', { lampesActives: lights.lightsActive });
}

/** Files the image's CPU steps into the profile and the sample the progress diagnostic reports. */
export function recordGpuCutTiming(rt: WebgpuPagesRuntime) {
  const { timing, run } = rt,
    m = timing.marks;
  const submitMs = m.cpuEnd - m.encodeStart;
  timing.lastSubmitMs = submitMs;
  const steps = timing.cpuProfile.row;
  steps[0] = m.lightsEnd - m.cpuStart;
  steps[1] = m.adoptEnd - m.lightsEnd;
  steps[2] = m.transparentSelectEnd - m.adoptEnd;
  steps[3] = m.admissionEnd - m.transparentSelectEnd;
  steps[4] = m.queueEnd - m.admissionEnd;
  steps[5] = m.rowsEnd - m.queueEnd;
  steps[6] = m.residencyUploadEnd - m.rowsEnd;
  steps[7] = m.selectionEnd - m.residencyUploadEnd;
  steps[8] = timing.lastProjectMs;
  steps[9] = timing.lastPartitionMs;
  steps[10] = timing.lastItemsMs;
  // L'encodage restant exclut la soumission elle-même : les deux étapes ne se recouvrent jamais.
  steps[11] = Math.max(
    0,
    submitMs -
      timing.lastProjectMs -
      timing.lastPartitionMs -
      timing.lastItemsMs -
      timing.lastQueueSubmitMs,
  );
  steps[12] = timing.lastQueueSubmitMs;
  steps[13] = submitMs;
  steps[14] = m.cpuEnd - m.cpuStart;
  timing.cpuProfile.record(run.frame, m.cpuEnd - m.cpuStart);
  recordStages(rt);
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
    /** Pages the residency path had to touch: the cut's difference, not its size. */
    residencyPagesEntered: run.pagesEntered,
    residencyPagesExited: run.pagesExited,
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
      camera,
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
