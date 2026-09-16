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
 * Les coins sont ceux que la double précision calcule (`createBoxCorners`), arrondis en simple
 * précision pour le transport. Cet arrondi entre dans la borne d'erreur que le noyau de projection
 * porte : chaque coordonnée y est majorée par `8u · Σ|termes|`, où l'arrondi de l'entrée compte pour
 * l'un des trois `u` de chaque terme.
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
    for (let k = 0; k < CORNER_VALUES; k++) cornerPacked[base + k] = boxCorners.corners[at + k];
  }
  partition.uploadCorners(cornerPacked, from, to);
}
