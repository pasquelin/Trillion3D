import type { GpuSelection } from './gpuSelection.ts';
import { ensurePageTable } from './webgpuPagesEncodeDraws.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Ce qui fait avancer le flux d'une image : réclamer au cache les pages que la coupe veut, poser la
 * table de pages, synchroniser les rangs puis publier les drapeaux de résidence à la sélection GPU.
 *
 * Rend faux quand les identifiants de visibilité débordent : seule la coupe processeur sait alors
 * choisir un sous-ensemble représentable, et l'appelant décide de ce qu'il en dit.
 */
export function streamCutResidency(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  selection: GpuSelection,
) {
  const { run, services } = rt,
    { rows } = rt.layout,
    marks = rt.timing.marks;
  services.queueCutResidency(run.desired);
  // Enumerate the bounded resident candidates once. GPU selection and compaction
  // share their page indices; no CPU frustum/LOD traversal or regrouping follows.
  marks.queueEnd = performance.now();
  ensurePageTable(rt, gpuDevice);
  services.syncRows();
  run.rowsSyncedFrame = run.frame;
  marks.rowsEnd = performance.now();
  if (rows.candidateOverflow) return false;
  // Le journal des rangs nomme les pages qui viennent d'entrer ou de sortir : la comparaison des
  // deux mille trois cents pages du DAG n'a plus lieu, et seules leurs plages sont réécrites.
  if (selection.updateResidency(rows.residentFlags, rows.residencyChanges))
    run.gpuMetricsReady = false;
  rows.clearResidencyChanges();
  marks.residencyUploadEnd = performance.now();
  return true;
}

/**
 * L'envoi de la sélection d'une image en attente de couverture. Rien n'est dessiné depuis un relevé
 * incomplet, mais l'attente ne peut pas se contenter de le relire : sans nouvel envoi, le même
 * relevé revient à chaque image et la coupe reste bloquée sur lui, caméra immobile, même une fois
 * les octets manquants arrivés. La sélection soumet ici son propre tampon de commandes, aucune passe
 * de dessin ne l'accompagne.
 */
export function dispatchWaitingSelection(rt: WebgpuPagesRuntime, selection: GpuSelection) {
  try {
    selection.dispatch(rt.run.selectionUniforms);
  } catch (error) {
    rt.diag.diagnosticFailure('gpu-selection-dispatch-failed', error);
  }
}
