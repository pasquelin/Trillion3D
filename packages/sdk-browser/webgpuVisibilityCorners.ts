import { CORNER_VALUES } from './gpuPartitionContract.ts';
import type { GpuPartition } from './gpuPartitionTypes.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Ce qui décrit les coins déjà envoyés à la carte : l'âge de la table dont ils sont sortis. */
export function createCornerUploadHold() {
  return { epoch: -1, count: 0 };
}

/**
 * Les huit coins monde de chaque ligne dessinable, dans le tampon que la projection GPU lit.
 *
 * Un coin ne change que quand la matrice monde de sa page change, et l'âge de la table nomme
 * exactement ce moment-là : une caméra qui bouge n'en réécrit aucun. Sur une image ordinaire, seule
 * la plage que la table vient de déclarer sale voyage — le même intervalle que les sphères d'ombre
 * empruntent —, et un âge nouveau redemande les lignes dessinables, une fois.
 *
 * Les coins sont ceux que la double précision calcule (`createBoxCorners`), portés chacun par DEUX
 * simples précisions : la valeur arrondie et son résidu. Le noyau les rapporte à la pose de la
 * caméra, elle aussi en deux mots, si bien que la magnitude monde ne survit à aucune soustraction et
 * que sa borne d'erreur ne dépend plus que de la taille du cluster (`gpuPartitionMargins.ts`).
 */
export function uploadRowCorners(rt: WebgpuPagesRuntime, partition: GpuPartition) {
  const { rows, boxCorners, cornerPacked, cornerHold } = rt.layout;
  const last = rows.packedCount - 1;
  let from = rows.dirtyFrom,
    to = Math.min(rows.dirtyTo, last);
  if (cornerHold.epoch !== rows.tableEpoch) {
    cornerHold.epoch = rows.tableEpoch;
    from = 0;
    to = last;
  } else if (rows.packedCount > cornerHold.count) {
    from = Math.min(from, cornerHold.count);
    to = last;
  }
  cornerHold.count = rows.packedCount;
  if (to < from) return;
  for (let row = from; row <= to; row++) {
    const rec = rows.packedRecs[row];
    const base = row * CORNER_VALUES;
    if (!rec) {
      cornerPacked.fill(0, base, base + CORNER_VALUES);
      continue;
    }
    const at = boxCorners.at(rows.packedPageIndex[row], rec, rows.tableEpoch);
    // Chaque coordonnée part en deux mots : l'arrondi simple précision, puis ce qu'il a laissé. La
    // somme des deux représente le double d'origine à un ulp au carré près.
    for (let k = 0; k < 8; k++)
      for (let axis = 0; axis < 3; axis++) {
        const value = boxCorners.corners[at + k * 3 + axis],
          high = Math.fround(value);
        cornerPacked[base + k * 6 + axis] = high;
        cornerPacked[base + k * 6 + 3 + axis] = value - high;
      }
  }
  partition.uploadCorners(cornerPacked, from, to);
}
