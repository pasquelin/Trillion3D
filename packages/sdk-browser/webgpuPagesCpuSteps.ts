import { addCpuSteps, cpuStepTable } from './stageMapping.ts';
import { sunFarCounts } from './webgpuPagesPrepareSunFar.ts';
import {
  frameCostAuditEnabled,
  gpuFrameCostSnapshot,
  logFrameCostAudit,
} from './frameCostAudit.ts';
import type { HostCpuStep } from './hostCpuProfile.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Les bornes processeur d'une image, dans l'ordre : pour chacune, son nom public et l'étape du
 * profil où elle se dépose. Le nom, l'étape et l'indice d'écriture sortent de cette seule table.
 * Les deux premières couvrent ce que l'image fait avant d'ouvrir son propre chronomètre ; les
 * quatre qui suivent l'encodage sont relevées par l'hôte, qui les dépose par leur nom.
 */
const CPU = cpuStepTable([
  ['worldMs', 'animations'],
  ['blendWorldMs', 'transparents'],
  ['lightsMs', 'lights'],
  ['adoptCutMs', 'cutAdoption'],
  ['transparentSelectMs', 'transparents'],
  ['transparentPrepareMs', 'transparents'],
  ['transparentDrawMs', 'transparents'],
  ['transparentEncodeMs', null],
  ['admissionMs', 'residency'],
  ['residencyQueueMs', 'residency'],
  ['syncRowsMs', 'uploads'],
  ['residencyUploadMs', 'uploads'],
  ['selectionDispatchMs', 'selection'],
  ['partitionMs', 'partition'],
  ['encodeRestMs', 'encode'],
  ['queueSubmitMs', 'submit'],
  ['arrivalsMs', 'residency'],
  ['pendingMs', 'hostPages'],
  ['retainMs', 'hostPages'],
  ['submitMs', 'submit'],
  ['encodeSubmitMs', null],
  ['totalMs', null],
] as const);
export const CPU_STEP_NAMES = CPU.names;
export const CPU_STEP = CPU.at;

/** Dépose les bornes processeur de l'image dans le profil public par étape, quand il est monté. */
function recordStages(rt: WebgpuPagesRuntime) {
  const { timing, lights, bounce } = rt,
    stages = timing.stages;
  if (!stages) return;
  stages.frameCpu((add) => {
    addCpuSteps(CPU.stages, timing.cpuProfile.row, add);
    // L'ordre des textures est calculé dans la pompe, hors de la ligne des bornes processeur : il se
    // dépose ici, et seulement tant que la file porte du travail. Une file vide n'a pas coûté zéro,
    // elle n'a rien fait du tout — l'étape reste « non mesuré ».
    if (rt.vis.textureJobs.length) add('textures', rt.texturePriority.lastMs);
  });
  const demand = rt.texturePriority.counters;
  stages.setCounts('textures', {
    couchesAuNiveauVoulu: demand.atWanted,
    couchesVisibles: demand.visible,
    niveauxManquants: Math.round(demand.missingAverage * 100),
    octetsEngages: rt.textureLedger.committed,
    evictions: rt.textureLedger.evictions,
  });
  if (!rt.vis.textureJobs.length)
    stages.setReason('textures', {
      cpu: 'file vide : aucun ordre à calculer',
      gpu: 'les transferts passent par la file de la carte, sans passe horodatée',
    });
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
  // Diagnostic seul : le comptage du surdessin des transparents, quand la variante le monte. Le
  // maximum par pixel n'est pas mesurable par requête d'occlusion : il n'est pas publié.
  const overdraw = rt.blendState.overdraw;
  if (overdraw)
    stages.setCounts('transparents', overdraw.pull(rt.gpu.targetSize[0] * rt.gpu.targetSize[1]));
  stages.setCounts('partition', timing.partitionCounts);
  timing.encodeCounts.appelsDeDessin = rt.run.gpuDrawCalls;
  timing.encodeCounts.appelsDeMelange = rt.run.blendDrawCalls;
  stages.setCounts('encode', timing.encodeCounts);
}

/**
 * Publishes where the image's CPU time went, on the cadence of the progress diagnostic. It is called
 * by both render paths: a measured loop renders without ever flushing, and the profile is exactly what
 * such a loop needs.
 */
export function publishCpuProfile(rt: WebgpuPagesRuntime) {
  const { timing, run, diag } = rt;
  if (
    (diag.traceEnabled && !frameCostAuditEnabled()) ||
    !timing.cpuSample ||
    run.frame === timing.lastCpuLogFrame
  )
    return;
  const now = performance.now();
  if (now - timing.lastCpuLogMs < 2000) return;
  timing.lastCpuLogMs = now;
  timing.lastCpuLogFrame = run.frame;
  const details = {
    ...timing.cpuSample,
    steps: timing.cpuProfile.summary(),
    audit: gpuFrameCostSnapshot(rt),
  };
  diag.engineDiagnostic('cpu-timing', 'Durées CPU mesurées dans le moteur', details);
  logFrameCostAudit('webgpu-page-raster', { kind: 'cpu-profile', ...details });
}

/** Dépose la durée d'une étape relevée par l'hôte : arrivées, attente, rétention, soumission. */
export function hostCpuStep(rt: WebgpuPagesRuntime, step: HostCpuStep, ms: number) {
  rt.timing.cpuProfile.row[CPU.at[step]] = ms;
}

/**
 * Clôt l'image du côté de l'hôte : les bornes que l'hôte relève après le rendu appartiennent à
 * l'image qui vient de se dessiner, donc la ligne n'est classée qu'ici. Une image qui n'a pas
 * rempli de ligne — coupe processeur, image en attente de couverture — ne dépose rien plutôt
 * qu'une ligne de zéros.
 */
export function endCpuFrame(rt: WebgpuPagesRuntime) {
  const { timing, run } = rt;
  if (!timing.rowFilled) return;
  timing.rowFilled = false;
  timing.cpuProfile.record(run.frame, timing.cpuProfile.row[CPU.at.totalMs]);
  recordStages(rt);
  publishCpuProfile(rt);
}
