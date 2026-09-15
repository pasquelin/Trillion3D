import { clusterErrorAtDistance } from '../sdk-core/index.ts';
import type { ClusterCut } from './pageSelectionMath.ts';

/**
 * `|vue(centre)|`, la seule racine carrée d'une borne : deux bornes posées sur la même sphère la
 * partagent, et les formules qui la reçoivent sont celles des projections, aux mêmes bits près.
 */
export function viewDistance(sphere: ArrayLike<number>, offset: number, e: ArrayLike<number>) {
  const cx = sphere[offset],
    cy = sphere[offset + 1],
    cz = sphere[offset + 2];
  const vx = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
  const vy = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
  const vz = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
  return Math.sqrt(vx * vx + vy * vy + vz * vz);
}

/** `projectedClusterError` dont la distance du centre est déjà connue. */
export function projectedErrorAt(
  error: number | null | undefined,
  distance: number,
  radius: number,
  stretch: number,
  focal: number,
  near: number,
) {
  if (error === 0) return 0;
  if (error == null || error === Infinity) return Infinity;
  return clusterErrorAtDistance(error, stretch, distance, radius, focal, near);
}

/**
 * Plancher de l'erreur projetée d'un sous-arbre : l'erreur la plus faible qu'il porte, vue du point
 * le plus lointain que sa sphère englobante autorise. Jamais au-dessus de la valeur vraie d'un de
 * ses clusters, donc utilisable pour décider d'un sous-arbre entier sans le descendre.
 *
 * Preuve de la borne : une sphère (c_i, r_i) contenue dans (C, R) vérifie |c_i − C| ≤ R, donc après
 * une transformation qui étire d'au plus `stretch`, |vue(c_i)| ≤ |vue(C)| + R·stretch. La distance
 * qu'utilise `clusterErrorPixels` vaut |vue(c_i)| − r_i·stretch ≤ |vue(C)| + R·stretch, et l'erreur
 * projetée décroît avec la distance : diviser l'erreur minimale par cette distance maximale ne peut
 * pas dépasser la plus petite erreur projetée du sous-arbre.
 *
 * `distance` est `|vue(C)|`, déjà calculé par l'appelant : le plancher et le plafond d'un même nœud
 * partagent leur racine carrée.
 */
export function errorFloorAt(
  error: number,
  distance: number,
  radius: number,
  stretch: number,
  focal: number,
) {
  if (error === 0) return 0;
  if (error === Infinity) return Infinity;
  // Sans sphère englobante, aucune borne à opposer : le plancher ne certifie rien.
  if (!(error > 0) || !(radius >= 0)) return 0;
  const far = distance + radius * stretch;
  // Tout le sous-arbre est alors sur la caméra ou derrière : son erreur projetée est infinie.
  if (!(far > 0)) return Infinity;
  return (error * stretch * focal) / far;
}

/**
 * `cutSelects` quand le seuil vaut zéro, sans rien projeter.
 *
 * L'erreur projetée n'est jamais négative, donc « > 0 » vaut « ≠ 0 » ; et `projectedClusterError` ne
 * rend 0 que pour une erreur nulle — le plan proche rend l'infini, une sphère absente aussi, et le
 * quotient `erreur·étirement·focale / distance` est strictement positif dès que l'étirement et la
 * focale le sont. Le résultat ne dépend donc ni de la caméra ni de la sphère : à seuil nul la coupe
 * retient exactement les clusters exacts que quelque chose remplace. L'appelant ne prend ce chemin
 * que lorsque l'étirement, la focale et le plan proche de l'image sont finis et strictement positifs.
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
