import type * as THREE from 'three';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { mirrorDrawnFromShown } from './webgpuPagesHelpers.ts';
import { abandonFrameEncoder, openFrameEncoder } from './webgpuPagesEncoder.ts';
import { fallbackToCpuCut } from './webgpuPagesDrops.ts';
import { ensureTargets } from './webgpuPagesTargets.ts';
import { encodeDraws } from './webgpuPagesEncodeDraws.ts';
import { admitGpuCut } from './webgpuPagesGpuCutAdmission.ts';
import { dispatchWaitingSelection, streamCutResidency } from './webgpuPagesGpuCutStream.ts';
import { keepWebgpuFrame } from './webgpuFrameHold.ts';
import {
  recordGpuCutTiming,
  traceGpuCutFrame,
  traceGpuCutWaiting,
} from './webgpuPagesGpuCutTrace.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Gives the image up to the CPU cut after the GPU selection let it down. */
function withoutGpuSelection(rt: WebgpuPagesRuntime, reason: string) {
  fallbackToCpuCut(rt, reason);
  rt.run.gpuFrameActive = false;
  return false;
}

/** One image driven by the GPU cluster cut: the mask of the current frame decides the draw, the
 *  readback of the previous one decides streaming and metrics. Returns false when the caller must
 *  render the image again through the CPU cut. */
export function renderGpuCut(
  rt: WebgpuPagesRuntime,
  camera: THREE.PerspectiveCamera,
  pixelError: number,
  cpuStart: number,
  lightsEnd: number,
) {
  const { run, gpu, diag, context, services } = rt,
    { rows } = rt.layout,
    { gpuDevice, viewport, clearColor } = rt.setup,
    marks = rt.timing.marks;
  if (!gpuDevice || !gpu.cache || !run.gpuSelection) {
    // Origine du changement de ressources : l'appareil, le cache ou la sélection ont disparu.
    run.gate.resourcesChanged();
    return true;
  }
  run.gpuFrameActive = true;
  run.cpuSelectMs = null;
  marks.cpuStart = cpuStart;
  marks.lightsEnd = lightsEnd;
  // `budgetPixelError` carries the previous frame's verdict, the same feedback `pageBudget` applies
  // on the CPU path.
  const budgeted = Math.max(pixelError, run.budgetPixelError);
  cameraSelectionUniforms(camera, budgeted, viewport, run.selectionUniforms);
  // An image that adopts no readback moves no page; the adoption reports what it actually moved.
  run.pagesEntered = 0;
  run.pagesExited = 0;
  services.adoptGpuCut();
  marks.adoptEnd = performance.now();
  // One cut covers both passes: the image sweeps no DAG of its own for the transparents any more.
  marks.transparentSelectEnd = marks.adoptEnd;
  if (run.gpuMetricsReady) run.visible = run.desired.length;
  admitGpuCut(rt, pixelError, budgeted);
  if (!services.bootstrapState.ready || gpu.cutIncomplete) {
    // L'image n'est pas complète : rien ne peut être tenu sur elle. Origine du changement de
    // ressources : l'amorçage n'a pas encore toutes ses pages — ou une page voulue n'est pas encore
    // arrivée, ce qui met l'image en attente sans jamais jeter la sélection GPU.
    run.gate.resourcesChanged();
    run.gpuMetricsReady = false;
    marks.admissionEnd = performance.now();
    // La couverture incomplète n'atteint jamais l'écran : l'image affichée reste la précédente. Mais
    // l'attente continue de réclamer les pages manquantes, de synchroniser la résidence et d'envoyer
    // la sélection — c'est le seul envoi qui peut produire le relevé complet de la reprise.
    if (streamCutResidency(rt, gpuDevice, run.gpuSelection))
      dispatchWaitingSelection(rt, run.gpuSelection);
    traceGpuCutWaiting(rt);
    return true;
  }
  marks.admissionEnd = performance.now();
  if (!streamCutResidency(rt, gpuDevice, run.gpuSelection)) {
    // The CPU fallback can still select a representable visible subset.
    diag.engineDiagnostic(
      'gpu-selection-capacity',
      'Sélection CPU requise par la capacité des identifiants de visibilité',
      {
        residentCandidates: rows.candidateCount + rows.candidateOverflow,
        maxCandidates: rt.layout.drawSlots,
      },
    );
    return withoutGpuSelection(rt, 'capacité des identifiants de visibilité');
  }
  try {
    rt.timing.frameSelection = run.gpuSelection.dispatch(
      run.selectionUniforms,
      openFrameEncoder(rt, gpuDevice),
    );
  } catch (error) {
    abandonFrameEncoder(rt);
    diag.diagnosticFailure('gpu-selection-dispatch-failed', error);
    return withoutGpuSelection(rt, 'envoi de la sélection en erreur');
  }
  // Une image dont ni l'adoption ni la coupe processeur n'a touché ces listes repousserait
  // quatre-vingt mille enregistrements déjà en place : le drapeau le dit, la recopie s'en abstient.
  mirrorDrawnFromShown(run);
  marks.selectionEnd = performance.now();
  const [width, height] = viewport;
  ensureTargets(rt, gpuDevice, Math.max(1, width), Math.max(1, height));
  if (!run.renderPathLogged) {
    run.renderPathLogged = true;
    diag.engineDiagnostic('first-render-path', 'Configuration du premier rendu WebGPU', {
      clearColor: `#${clearColor.toString(16).padStart(6, '0')}`,
      targetSize: gpu.targetSize,
      visibilityBuffer: true,
      selection: 'current-frame-mask',
      residentCandidates: rows.candidateCount,
    });
  }
  marks.encodeStart = performance.now();
  try {
    encodeDraws(rt, gpuDevice, camera);
  } catch (error) {
    abandonFrameEncoder(rt);
    if (context.gpuCanvas) throw error;
    return withoutGpuSelection(rt, 'encodage du dessin en erreur');
  }
  // An encode path that returned without submitting would strand the selection's readback slot.
  abandonFrameEncoder(rt);
  marks.cpuEnd = performance.now();
  // The cut's own triangles came back with the readback; the meshes outside the DAG are counted
  // where they are drawn.
  if (run.gpuMetricsReady) run.submittedTriangles = run.drawnTriangles + run.blendUnpagedTriangles;
  recordGpuCutTiming(rt);
  traceGpuCutFrame(rt, camera);
  // L'image a été encodée et soumise en entier : elle seule autorise une tenue, et seulement si la
  // précédente lui était déjà identique.
  keepWebgpuFrame(rt);
  return true;
}
