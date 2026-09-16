import { sampleWebgpuFrame } from './webgpuFrameSignature.ts';
import { CPU_STEP } from './webgpuPagesCpuSteps.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import type { WebgpuRunState } from './webgpuPagesStateRun.ts';

/**
 * Vrai quand chaque page de la coupe demandée porte ses octets. Une page encore attendue peut encore
 * changer la coupe, donc l'image : tenir celle-ci ouvrirait un trou. La liste est celle de la coupe,
 * pas le catalogue.
 */
function cutComplete(run: WebgpuRunState) {
  for (let i = 0; i < run.desired.length; i++) if (!run.desired[i].array) return false;
  return true;
}

/**
 * Vrai quand plus rien ne peut changer l'image en dehors d'une écriture de l'hôte : aucun chargement
 * en cours, aucun relevé encore à adopter, aucun historique d'occultation à établir, aucune texture
 * en vol, aucune ombre en attente, aucune sonde à converger. Tout doute se tranche ici du côté
 * « refaire le travail » : chaque condition manquante rend faux.
 */
function frameSettled(rt: WebgpuPagesRuntime) {
  const { run, vis, lights, bounce, capture, services, timing } = rt,
    { rows } = rt.layout;
  return (
    !run.lost &&
    !capture.secondaryCamera &&
    !capture.capturePending &&
    !timing.frameEncoder &&
    vis.visEnabled &&
    !!vis.gpuDraw &&
    run.gpuFrameActive &&
    run.gpuMetricsReady &&
    run.cutHeld &&
    !run.overBudget &&
    !run.coverageBudgetLimited &&
    run.uncoveredTriangles === 0 &&
    !run.noOccluderHistory &&
    !run.deferredDrops.size &&
    services.bootstrapState.ready &&
    !services.residency.busy &&
    !rows.rowsChanged &&
    rows.dirtyTo < rows.dirtyFrom &&
    rows.rowsEpoch === rows.tableEpoch &&
    !rows.candidateOverflow &&
    !vis.textureJobs.length &&
    !rt.texturePump.inFlight &&
    !lights.plan.counts.pendingPages &&
    // Les sondes de la lumière qui rebondit convergent d'image en image : leur état n'est écrit par
    // aucune révision, et une image tenue le figerait avant la convergence.
    !bounce.probes &&
    cutComplete(run)
  );
}

/**
 * Ce qu'une image tenue a réellement fait, publié comme tel.
 *
 * Elle n'a encodé qu'une présentation : aucun cluster n'a été dessiné, aucune passe n'a tourné,
 * aucune étape processeur n'a été exécutée. Republier les compteurs de dessin et les durées du
 * dernier rendu complet décrirait un travail que cette image-ci n'a pas fait. Les métriques de la
 * COUPE — pages retenues, triangles sélectionnés, rejet par le tronc, pages résidentes — restent
 * intactes : c'est la même coupe, réaffichée, et elle décrit toujours ce que l'image montre.
 */
function recordHeldFrameWork(rt: WebgpuPagesRuntime, presented: boolean, submitMs: number) {
  const { run, timing } = rt;
  run.gpuDrawCalls = presented ? 1 : 0;
  run.blendDrawCalls = 0;
  run.submittedTriangles = 0;
  run.blendSubmittedTriangles = 0;
  run.cpuSelectMs = null;
  // Aucune passe n'a été chronométrée sur l'appareil : « non mesuré », jamais la durée d'une autre.
  timing.lastGpuPassMs = null;
  timing.lastGpuFrameMs = null;
  timing.lastGpuHostGapMs = null;
  timing.lastSubmitMs = submitMs;
  const steps = timing.cpuProfile.row;
  steps.fill(0);
  steps[CPU_STEP.queueSubmitMs] = submitMs;
  steps[CPU_STEP.encodeSubmitMs] = submitMs;
  steps[CPU_STEP.submitMs] = submitMs;
  steps[CPU_STEP.totalMs] = submitMs;
  timing.rowFilled = true;
  // Le relevé détaillé décrit une image encodée ; celle-ci n'en est pas une, et n'en republie pas.
  timing.cpuSample = undefined;
}

/**
 * L'image tenue. Aucune étape processeur n'est exécutée et rien n'est réencodé : la cible couleur de
 * l'image précédente EST cette image-ci, au bit près, puisque rien de ce dont elle dépend n'a bougé.
 * Elle est simplement réaffichée.
 *
 * Un `GPUCommandBuffer` déjà soumis ne se resoumet pas, et un `GPURenderBundle` ne peut porter ni les
 * passes de calcul de l'image — sélection, pyramide Hi-Z, petits triangles, listes de lampes,
 * résolution différée — ni ses copies : rejouer les seuls paquets de rendu ne redonnerait pas
 * l'image. Réafficher la cible intacte la redonne exactement, et c'est la seule commande encodée.
 */
export function holdWebgpuFrame(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { run, gpu } = rt;
  if (!run.frameHold.stable || !run.frameHold.same(run.revisions) || !frameSettled(rt)) {
    run.frameHeld = false;
    return false;
  }
  run.frameHeld = true;
  run.frame++;
  const start = performance.now();
  let presented = false;
  if (gpu.presenter && gpu.colorTexture) {
    const encoder = device.createCommandEncoder({ label: 'WG image tenue' });
    gpu.presenter.present(encoder, gpu.colorTexture, gpu.targetSize[0], gpu.targetSize[1]);
    device.queue.submit([encoder.finish()]);
    run.imageRevision++;
    if (gpu.canvasTexture) gpu.canvasTexture.needsUpdate = true;
    presented = true;
  }
  recordHeldFrameWork(rt, presented, performance.now() - start);
  return true;
}

/** Range l'image qui vient d'être encodée et soumise en entier : elle seule autorise une tenue. */
export function keepWebgpuFrame(rt: WebgpuPagesRuntime) {
  sampleWebgpuFrame(rt, rt.run.frameHold.sample);
  rt.run.frameHold.keep(rt.run.revisions);
}
