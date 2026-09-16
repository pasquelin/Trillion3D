import type { NumberSink } from './mathMatrix4.ts';
import { adjugateFactor } from './mathSingular.ts';

/**
 * `out = transposée(inverse(bloc 3×3 de m))`, colonne-major sur neuf nombres : la matrice qui porte
 * les normales d'une surface transformée par `m`, cisaillement et échelle non uniforme compris.
 * L'inverse est celui de la référence, cofacteurs et ordre des produits compris, puis transposé sans
 * aucune opération flottante.
 *
 * MATRICE SINGULIÈRE : l'ADJOINTE, non divisée, et non la matrice nulle de la référence. Ce qui
 * décide de la singularité est la règle unique du moteur (`mathSingular.ts`), celle-là même que le
 * noyau WGSL applique — le déterminant de la partie linéaire NORMALISÉE, jamais le déterminant brut,
 * qui ne juge que l'échelle. Une matrice régulière rend ici exactement les bits d'avant : le facteur
 * reste `1 / det`, le déterminant BRUT, et la règle ne fait que choisir la branche.
 * Une pose singulière n'efface pas la surface, elle l'aplatit sur un plan : ses faces y gardent une
 * aire et une normale. `cof(M)·(e1 × e2) = (M e1) × (M e2)` — l'adjointe appliquée à une normale
 * locale EST le produit vectoriel des arêtes transformées, signe compris — et tout consommateur
 * normalise ensuite, ce qui efface le facteur d'échelle manquant. Rang ≤ 1, la primitive est
 * effondrée sur une droite ou un point : les colonnes sont parallèles, l'adjointe est nulle d'elle
 * même, et la normale sort nulle sans qu'aucun cas particulier ne l'écrive. Une échelle nulle,
 * infinie ou NaN est le seul cas écrit à part : neuf zéros, parce qu'un terme NaN ne se corrige pas
 * en le multipliant. C'est la convention du moteur, la même que celle du noyau WGSL de
 * `packages/sdk-browser/inverseTransposeWgsl.ts`, où elle est écrite en entier ; la référence, elle,
 * rend zéro sur toute matrice singulière et perd la surface.
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
  // Le facteur vient de la règle unique du moteur : `1 / det` si la matrice est régulière — les bits
  // d'avant —, `1` si elle est singulière, et rien du tout si son échelle n'est ni finie ni
  // strictement positive. Les trois premiers cofacteurs sont déjà là — le déterminant les a
  // exigés — et les six autres sont ceux de la multiplication ci-dessous.
  const detInv = adjugateFactor(m, det);
  // Échelle nulle, infinie ou NaN : neuf zéros, comme le noyau WGSL qui remplace alors son adjointe.
  // La primitive n'a plus ni aire ni normale, et rien de non fini ne part dans l'éclairage.
  if (detInv === null) {
    for (let i = 0; i < 9; i++) out[i] = 0;
    return out;
  }
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
