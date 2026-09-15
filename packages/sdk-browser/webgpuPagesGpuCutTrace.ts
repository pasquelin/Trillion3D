import type * as THREE from 'three';
import { addCpuSteps } from './stageMapping.ts';
import { CPU_STEP, CPU_STEP_STAGES, publishCpuProfile } from './webgpuPagesStateTiming.ts';
import { frameTraceSnapshot } from './webgpuPagesRenderTrace.ts';
import { sunFarCounts } from './webgpuPagesPrepareSunFar.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Dépose les bornes processeur de l'image dans le profil public par étape, quand il est monté. */
function recordStages(rt: WebgpuPagesRuntime) {
  const { timing, lights, bounce } = rt,
    stages = timing.stages;
  if (!stages) return;
  stages.frameCpu((add) => addCpuSteps(CPU_STEP_STAGES, timing.cpuProfile.row, add));
  // Ce que la passe d'ombres a réellement redessiné : des compteurs, jamais des durées. Les six
  // compteurs d'avant sont gardés tels quels — le Lab les lit — et les pages s'y ajoutent :
  // `pagesInvalidees` est ce qui est entré en file à cette image, `pagesRedessinees` ce que les
  // régions retenues couvrent, `pagesEnAttente` ce que le budget a laissé pour plus tard, et
  // `retardMaxMs` l'attente de la page la plus ancienne de cette file.
  const { counts } = lights.plan;
  stages.setCounts('shadows', {
    lampesRedessinees: lights.shadowsUpdated,
    cartesReutilisees: counts.reused,
    facesRedessinees: lights.shadowFaces,
    appelsDeDessin: lights.shadowDrawCalls,
    soleilsRedessines: counts.sunLights,
    cascadesRedessinees: lights.sunCascades,
    regionsRedessinees: lights.shadowRegions,
    pagesInvalidees: counts.invalidatedPages,
    pagesRedessinees: lights.shadowPages,
    pagesEnAttente: counts.pendingPages,
    retardMaxMs: counts.waitedMs,
    retardMaxImages: counts.waitedFrames,
  });
  stages.setCounts('lightLists', { lampesActives: lights.lightsActive });
  // L'ombre lointaine du soleil : des compteurs relevés sur une image sur quinze, jamais une durée.
  // Son rayon est tiré dans la résolution différée, donc ses millisecondes sont celles de l'étape
  // « Éclairage (résolution) » — dire une durée ici en compterait une seconde fois.
  stages.setCounts('sunFarShadows', sunFarCounts(rt));
  stages.setReason('sunFarShadows', {
    cpu: 'aucun travail processeur : le rayon lointain est tiré par la résolution différée',
    gpu:
      rt.sunFar.reason ??
      'mesurée dans l’étape « Éclairage (résolution) », qui tire le rayon lointain',
  });
  // Ce que le rebond a réellement fait : des sondes et des rayons, jamais une durée. Une scène
  // immobile et convergée n'encode aucune passe, donc l'étape reste « non mesuré » et non zéro.
  stages.setCounts('bounce', {
    sondesMisesAJour: bounce.probesUpdated,
    rayonsParImage: bounce.raysLaunched,
    sondesDesCascades: bounce.probes?.cascades.probes ?? 0,
    maillesMisesAJour: bounce.encoded ? (bounce.probes?.surface.lastTexels ?? 0) : 0,
    maillesDuCache: bounce.probes?.surface.texels ?? 0,
    // La fraction du plafond que le budget en millisecondes tient, en millièmes : un compteur est
    // un entier, et c'est la durée qui décide de ce compte, jamais l'inverse.
    fractionDuBudget: Math.round((bounce.probes?.budget.load ?? 0) * 1000),
  });
  if (!bounce.probes)
    stages.setReason('bounce', {
      cpu: bounce.reason ?? 'rebond absent',
      gpu: bounce.reason ?? 'rebond absent',
    });
  stages.setCounts('partition', timing.partitionCounts);
  timing.encodeCounts.appelsDeDessin = rt.run.gpuDrawCalls;
  timing.encodeCounts.appelsDeMelange = rt.run.blendDrawCalls;
  stages.setCounts('encode', timing.encodeCounts);
}

/** Files the image's CPU steps into the profile and the sample the progress diagnostic reports. */
export function recordGpuCutTiming(rt: WebgpuPagesRuntime) {
  const { timing, run } = rt,
    m = timing.marks;
  const submitMs = m.cpuEnd - m.encodeStart;
  timing.lastSubmitMs = submitMs;
  const steps = timing.cpuProfile.row;
  steps[CPU_STEP.lightsMs] = m.lightsEnd - m.cpuStart;
  steps[CPU_STEP.adoptCutMs] = m.adoptEnd - m.lightsEnd;
  steps[CPU_STEP.transparentSelectMs] = m.transparentSelectEnd - m.adoptEnd;
  steps[CPU_STEP.transparentEncodeMs] = timing.transparentEncodeMs;
  steps[CPU_STEP.admissionMs] = m.admissionEnd - m.transparentSelectEnd;
  steps[CPU_STEP.residencyQueueMs] = m.queueEnd - m.admissionEnd;
  steps[CPU_STEP.syncRowsMs] = m.rowsEnd - m.queueEnd;
  steps[CPU_STEP.residencyUploadMs] = m.residencyUploadEnd - m.rowsEnd;
  steps[CPU_STEP.selectionDispatchMs] = m.selectionEnd - m.residencyUploadEnd;
  steps[CPU_STEP.projectBoxesMs] = timing.lastProjectMs;
  steps[CPU_STEP.partitionMs] = timing.lastPartitionMs;
  steps[CPU_STEP.itemsMs] = timing.lastItemsMs;
  // L'encodage restant exclut la soumission elle-même : les deux étapes ne se recouvrent jamais.
  steps[CPU_STEP.encodeRestMs] = Math.max(
    0,
    submitMs -
      timing.lastProjectMs -
      timing.lastPartitionMs -
      timing.lastItemsMs -
      timing.transparentEncodeMs -
      timing.lastQueueSubmitMs,
  );
  steps[CPU_STEP.queueSubmitMs] = timing.lastQueueSubmitMs;
  steps[CPU_STEP.encodeSubmitMs] = submitMs;
  steps[CPU_STEP.totalMs] = m.cpuEnd - m.cpuStart;
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
