// Oracle pur de A9, sans effet de bord : `pages.bench.mjs` le mesure, les tests unitaires
// l'importent comme référence.

/** `webgpuPagesPipelineFor.ts:22-30` avant le lot A : un déterminant 3×3 par appel. */
export function referenceWindingCw(rec) {
  const e = rec.matrix.elements;
  return (
    e[0] * (e[5] * e[10] - e[6] * e[9]) -
      e[1] * (e[4] * e[10] - e[6] * e[8]) +
      e[2] * (e[4] * e[9] - e[5] * e[8]) <
    0
  );
}
