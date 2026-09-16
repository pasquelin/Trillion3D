import { CORNER_VALUES } from './gpuPartitionContract.ts';
import { createTransparentOcclusion } from './gpuTransparentOcclusion.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import { packBoxCorners } from './webgpuVisibilityCorners.ts';

/**
 * Monte le test d'occultation des grappes transparentes, une fois que tout ce qu'il emprunte existe.
 *
 * Il n'est ni un repli ni une option : sans pyramide, sans partition ou sans compaction GPU il n'y a
 * simplement rien à dépouiller, et la table transparente garde alors toutes ses entrées — l'image
 * est la même, au prix qu'elle avait. Le tampon de verdicts appartient à la compaction et vaut zéro
 * tant que personne ne l'écrit.
 */
export async function prepareTransparentOcclusion(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, blendState } = rt,
    { table, compaction } = blendState;
  const hiz = vis.gpuHiz,
    partition = vis.gpuPartition;
  if (!hiz || !partition || !table || !compaction?.encode || !table.length) return;
  blendState.occlusion = await createTransparentOcclusion(device, table.capacity, {
    pyramid: () => hiz.pyramidBuffer(),
    uniforms: partition.uniforms,
    occluded: compaction.occludedBuffer,
  });
  if (!blendState.occlusion) return;
  blendState.occlusionCorners = new Float32Array(table.capacity * CORNER_VALUES);
  blendState.occlusionEpoch = -1;
}

/**
 * Les huit coins monde de chaque entrée de la table transparente, dans le tampon que le test lit.
 *
 * Une grappe transparente ne réclame aucune ligne du tampon de visibilité : ses coins ne voyagent
 * donc pas avec la plage sale de la table de lignes, et c'est ici qu'ils partent. Comme pour les
 * opaques, un coin ne change que quand la matrice monde de sa page change, et l'âge de la table
 * nomme exactement ce moment-là : une caméra qui bouge n'en réécrit aucun. Les doubles sont ceux de
 * `createBoxCorners`, portés chacun par deux simples précisions — l'arrondi et son résidu.
 */
export function refreshTransparentCorners(rt: WebgpuPagesRuntime) {
  const { blendState, layout } = rt,
    { table, occlusion } = blendState;
  if (!table || !occlusion) return;
  const epoch = layout.rows.tableEpoch;
  if (blendState.occlusionEpoch === epoch) return;
  blendState.occlusionEpoch = epoch;
  const packed = blendState.occlusionCorners,
    { boxCorners, packedPages } = layout;
  for (let entry = 0; entry < table.capacity; entry++) {
    const base = entry * CORNER_VALUES,
      page = table.pageOfEntry[entry];
    // Une entrée d'alignement ne nomme aucune page : ses coins restent nuls, et la compaction la
    // retire avant même de lire son verdict.
    if (page < 0) {
      packed.fill(0, base, base + CORNER_VALUES);
      continue;
    }
    packBoxCorners(packed, base, boxCorners.corners, boxCorners.at(page, packedPages[page], epoch));
  }
  occlusion.uploadCorners(packed, 0, table.capacity - 1);
}
