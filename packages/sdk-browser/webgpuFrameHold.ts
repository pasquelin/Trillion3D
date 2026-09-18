import { sampleWebgpuFrame } from './webgpuFrameSignature.ts';
import { CPU_STEP } from './webgpuPagesCpuSteps.ts';
import { beginTaaFrame, taaSettled } from './taaFrame.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Ce qui peut encore changer l'image, un bit chacun ; `unsettledReasons` les nomme. */
const REASONS = [
  'lost',
  'secondaryCamera',
  'capturePending',
  'frameEncoder',
  'visDisabled',
  'gpuFrameInactive',
  'cutMoving',
  'overBudget',
  'uncoveredTriangles',
  'noOccluderHistory',
  'deferredDrops',
  'bootstrap',
  'residencyBusy',
  'rowsDirty',
  'texturesPending',
  'shadowsPending',
  'cutPending',
  'bounceProbes',
] as const;
const BIT = Object.fromEntries(REASONS.map((reason, index) => [reason, 1 << index])) as Record<
  (typeof REASONS)[number],
  number
>;
export const TEXTURES_PENDING = BIT.texturesPending,
  SHADOWS_PENDING = BIT.shadowsPending;

/**
 * Ce qui empêche encore l'image de ne dépendre que d'une écriture de l'hôte, en bits : un chargement
 * en cours, un relevé encore à adopter, un historique d'occultation à établir, une texture en vol,
 * une ombre en attente, une sonde à converger. Zéro quand plus rien ne bouge. Tout doute se tranche
 * du côté « refaire le travail » : chaque condition manquante pose son bit. Aucune allocation : la
 * tenue le lit à chaque image, la barrière s'en sert de prédicat d'arrêt.
 */
export function unsettledMask(rt: WebgpuPagesRuntime) {
  const { run, vis, lights, bounce, capture, services, timing } = rt,
    { rows } = rt.layout;
  let mask = 0;
  if (run.lost) mask |= BIT.lost;
  if (capture.secondaryCamera) mask |= BIT.secondaryCamera;
  if (capture.capturePending) mask |= BIT.capturePending;
  if (timing.frameEncoder) mask |= BIT.frameEncoder;
  if (!vis.visEnabled || !vis.gpuDraw) mask |= BIT.visDisabled;
  if (!run.gpuFrameActive || !run.gpuMetricsReady) mask |= BIT.gpuFrameInactive;
  if (!run.cutHeld) mask |= BIT.cutMoving;
  if (run.overBudget || run.coverageBudgetLimited) mask |= BIT.overBudget;
  if (run.uncoveredTriangles !== 0) mask |= BIT.uncoveredTriangles;
  if (run.noOccluderHistory) mask |= BIT.noOccluderHistory;
  if (run.deferredDrops.size) mask |= BIT.deferredDrops;
  if (!services.bootstrapState.ready) mask |= BIT.bootstrap;
  if (services.residency.busy) mask |= BIT.residencyBusy;
  if (
    rows.rowsChanged ||
    rows.dirtyTo >= rows.dirtyFrom ||
    rows.rowsEpoch !== rows.tableEpoch ||
    rows.candidateOverflow
  )
    mask |= BIT.rowsDirty;
  // Une tuile demandée et pas encore servie changera l'image quand elle arrivera ; et une
  // convergence doit rendre pour lire ce que la pose demande, jamais tenir.
  if (vis.textures?.counters.pending || run.textureConverging) mask |= BIT.texturesPending;
  if (lights.plan.counts.pendingPages > 0) mask |= BIT.shadowsPending;
  // Chaque page de la coupe demandée porte ses octets. Une page encore attendue peut encore
  // changer la coupe, donc l'image : tenir celle-ci ouvrirait un trou. Ce compte est tenu par la
  // différence de la coupe, jamais relu sur la liste.
  if (services.cutPending.count) mask |= BIT.cutPending;
  // Les sondes de la lumière qui rebondit convergent d'image en image : leur état n'est écrit par
  // aucune révision, et une image tenue le figerait avant la convergence.
  if (bounce.probes) mask |= BIT.bounceProbes;
  return mask;
}

/** Les noms des bits posés : ce que la barrière publie quand la pose ne se pose pas. */
export const unsettledReasons = (mask: number) =>
  REASONS.filter((reason) => (mask & BIT[reason]) !== 0);

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
  run.gpuComputeDispatches = 0;
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
  // Image calme : rien de ce dont elle dépend n'a bougé et rien n'est en vol. C'est l'entrée
  // d'image de l'accumulation temporelle, qui y repart en phase fixe et converge sur un plein cycle
  // de ces images-là avant que l'une d'elles puisse être tenue (`TAA_STILL_FRAMES`).
  const quiet = run.gate.held() && unsettledMask(rt) === 0;
  beginTaaFrame(rt, run.gate.cam, quiet);
  if (!quiet || !taaSettled(rt)) {
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

/** Range l'image qui vient d'être encodée et soumise en entier : elle seule autorise une tenue.
 *  Une image de convergence rejoue la dernière image ordinaire : le témoin ne la voit pas, et deux
 *  images ordinaires identiques restent deux images consécutives à ses yeux. */
export function keepWebgpuFrame(rt: WebgpuPagesRuntime) {
  const { gate, textureConverging } = rt.run;
  if (textureConverging) return;
  sampleWebgpuFrame(rt, gate.hold.sample);
  gate.hold.keep(gate.revisions);
}
