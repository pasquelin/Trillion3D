import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Nombre de valeurs de la signature d'image ; voir `sampleWebgpuFrame`. */
export const HOLD_SIGNATURE_VALUES = 24;

/**
 * Tout ce qu'une image a produit d'observable, en vingt-quatre nombres.
 *
 * Deux images consécutives dont les trois révisions et ces vingt-quatre nombres sont identiques ont
 * fait exactement le même travail : mêmes lignes, même partition occulteurs/testés, mêmes appels de
 * dessin, mêmes triangles, mêmes verdicts d'occultation, mêmes ombres. C'est ce qui couvre les états
 * qui convergent sans être écrits — l'historique d'occulteurs que la moitié testée de l'image nourrit,
 * les verdicts relus avec un retard — sans avoir à en tenir la liste.
 */
export function sampleWebgpuFrame(rt: WebgpuPagesRuntime, into: Float64Array) {
  const { run, timing, lights } = rt,
    { rows } = rt.layout,
    counts = timing.partitionCounts,
    hiz = rt.vis.gpuHiz?.counts();
  into[0] = rows.tableEpoch;
  into[1] = rows.rowsEpoch;
  into[2] = rows.packedCount;
  into[3] = rows.rowCount;
  into[4] = run.cutEpoch;
  into[5] = run.pageArrayEpoch;
  into[6] = run.visible;
  into[7] = run.selectedTriangles;
  into[8] = run.submittedTriangles;
  into[9] = run.drawnTriangles;
  into[10] = run.uncoveredTriangles;
  into[11] = run.frustumRejected;
  into[12] = run.lodLevel;
  into[13] = run.gpuDrawCalls;
  into[14] = run.blendDrawCalls;
  into[15] = run.blendSubmittedTriangles;
  into[16] = run.blendFrustumRejected;
  into[17] = counts.occulteurs;
  into[18] = counts.testees;
  into[19] = run.occluderSignature;
  into[20] = lights.shadowsUpdated;
  into[21] = lights.shadowFaces;
  into[22] = hiz ? hiz.rejected : -1;
  into[23] = run.budgetPixelError;
}
