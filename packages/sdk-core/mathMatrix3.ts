import type { NumberSink } from './mathMatrix4.ts';

/**
 * `out = transposée(inverse(bloc 3×3 de m))`, colonne-major sur neuf nombres : la matrice qui porte
 * les normales d'une surface transformée par `m`, cisaillement et échelle non uniforme compris.
 * L'inverse est celui de la référence, cofacteurs et ordre des produits compris, puis transposé sans
 * aucune opération flottante ; un bloc de déterminant exactement nul rend la matrice nulle.
 */
export function normalMatrix3<T extends NumberSink>(out: T, m: ArrayLike<number>) {
  const n11 = m[0],
    n21 = m[1],
    n31 = m[2];
  const n12 = m[4],
    n22 = m[5],
    n32 = m[6];
  const n13 = m[8],
    n23 = m[9],
    n33 = m[10];
  const t11 = n33 * n22 - n32 * n23,
    t12 = n32 * n13 - n33 * n12,
    t13 = n23 * n12 - n22 * n13;
  const det = n11 * t11 + n21 * t12 + n31 * t13;
  if (det === 0) {
    for (let i = 0; i < 9; i++) out[i] = 0;
    return out;
  }
  const detInv = 1 / det;
  out[0] = t11 * detInv;
  out[3] = (n31 * n23 - n33 * n21) * detInv;
  out[6] = (n32 * n21 - n31 * n22) * detInv;
  out[1] = t12 * detInv;
  out[4] = (n33 * n11 - n31 * n13) * detInv;
  out[7] = (n31 * n12 - n32 * n11) * detInv;
  out[2] = t13 * detInv;
  out[5] = (n21 * n13 - n23 * n11) * detInv;
  out[8] = (n22 * n11 - n21 * n12) * detInv;
  return out;
}
