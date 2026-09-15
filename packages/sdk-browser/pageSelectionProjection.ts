import { clusterErrorAtDepth } from '../sdk-core/index.ts';
import type { ClusterCut } from './pageSelectionMath.ts';

/**
 * Distance à l'axe de vue, `|(vue(p).x, vue(p).y)|`, d'un point donné composante par composante :
 * la coupe plate le tire d'une sphère rangée dans un tableau, l'oracle du DAG de clusters de trois
 * nombres déjà séparés. Une seule écriture des multiplications, des sommes et de la racine.
 */
export function viewLateralOf(x: number, y: number, z: number, e: ArrayLike<number>) {
  const vx = e[0] * x + e[4] * y + e[8] * z + e[12];
  const vy = e[1] * x + e[5] * y + e[9] * z + e[13];
  return Math.sqrt(vx * vx + vy * vy);
}

/** Profondeur de vue, `−vue(p).z` (la caméra regarde vers −z), du même point. Aucune racine. */
export function viewDepthOf(x: number, y: number, z: number, e: ArrayLike<number>) {
  return -(e[2] * x + e[6] * y + e[10] * z + e[14]);
}

/** `viewLateralOf` du centre d'une sphère rangée en `offset`. */
export function viewLateral(sphere: ArrayLike<number>, offset: number, e: ArrayLike<number>) {
  return viewLateralOf(sphere[offset], sphere[offset + 1], sphere[offset + 2], e);
}

/** `viewDepthOf` du centre d'une sphère rangée en `offset`. */
export function viewDepth(sphere: ArrayLike<number>, offset: number, e: ArrayLike<number>) {
  return viewDepthOf(sphere[offset], sphere[offset + 1], sphere[offset + 2], e);
}

/** `projectedClusterError` dont la distance à l'axe et la profondeur du centre sont déjà connues. */
export function projectedErrorAt(
  error: number | null | undefined,
  lateral: number,
  depth: number,
  radius: number,
  stretch: number,
  focal: number,
  near: number,
) {
  if (error === 0) return 0;
  if (error == null || error === Infinity) return Infinity;
  return clusterErrorAtDepth(error, stretch, lateral, depth, radius, focal, near);
}

/**
 * Plancher de l'erreur projetée d'un sous-arbre : l'erreur la plus faible qu'il porte, vue à la
 * profondeur la plus lointaine que sa sphère englobante autorise. Jamais au-dessus de la valeur
 * vraie d'un de ses clusters, donc utilisable pour décider d'un sous-arbre entier sans le descendre.
 *
 * Preuve de la borne : une sphère (c_i, r_i) contenue dans (C, R) vérifie |c_i − C| + r_i ≤ R ;
 * après une transformation qui étire d'au plus `stretch`, la boule de vue (C_i, ρ_i) tient dans
 * (C, R·stretch), donc sa profondeur minimale m_i vérifie m_i ≤ −C_z + R·stretch. L'erreur de
 * `screenErrorBound` vaut (δ_i·f/m_i)·(√(m_i² + (ℓ_i + ρ_i)²)/(m_i − δ_i)), dont le second facteur
 * est ≥ 1 : elle dépasse δ_i·f/m_i ≥ ε_min·stretch·f / (−C_z + R·stretch). Si ce dénominateur est
 * nul ou négatif, toutes les sphères du sous-arbre sont sur le plan de l'œil ou derrière, et leur
 * erreur projetée est infinie.
 *
 * `depth` est `−vue(C).z`, déjà calculé par l'appelant : le plancher et le plafond d'un même nœud
 * la partagent.
 */
export function errorFloorAt(
  error: number,
  depth: number,
  radius: number,
  stretch: number,
  focal: number,
) {
  if (error === 0) return 0;
  if (error === Infinity) return Infinity;
  // Sans sphère englobante, aucune borne à opposer : le plancher ne certifie rien.
  if (!(error > 0) || !(radius >= 0)) return 0;
  const far = depth + radius * stretch;
  if (!(far > 0)) return Infinity;
  return (error * stretch * focal) / far;
}

/**
 * `cutSelects` quand le seuil vaut zéro, sans rien projeter.
 *
 * L'erreur projetée n'est jamais négative, donc « > 0 » vaut « ≠ 0 » ; et `projectedClusterError` ne
 * rend 0 que pour une erreur nulle — le plan proche rend l'infini, une sphère absente aussi, et
 * `screenErrorBound` est un produit de facteurs strictement positifs dès que l'erreur, l'étirement
 * et la focale le sont. Le résultat ne dépend donc ni de la caméra ni de la sphère : à seuil nul la
 * coupe retient exactement les clusters exacts que quelque chose remplace. L'appelant ne prend ce
 * chemin que lorsque l'étirement, la focale et le plan proche de l'image sont finis et strictement
 * positifs.
 *
 * L'identité vaut sur le domaine que la préparation garantit (`pageCarriesClusterError`,
 * `clusterErrorFields`) : une erreur propre finie positive vient toujours avec sa sphère, et une
 * erreur de remplaçant est nulle, finie positive avec sa sphère, ou absente. Une erreur mal formée
 * y est refusée des deux côtés. `pageSelectionProjection.test.ts` parcourt ce domaine et ses bords.
 */
export function cutSelectsAtZero(rec: ClusterCut) {
  const own = rec.lodError ?? 0;
  if (own !== 0) {
    // Une erreur ni nulle ni positive n'est pas une donnée de coupe : le chemin général lève, celui-ci aussi.
    if (!(own > 0)) throw new Error('Parametres de cluster invalides');
    return false;
  }
  const parent = rec.parentError;
  if (parent != null && !(parent >= 0)) throw new Error('Parametres de cluster invalides');
  return parent !== 0;
}
