import { clusterErrorPixels } from '../sdk-core/index.ts';
import * as THREE from 'three';

export type ClusterCut = {
  lodError?: number;
  sphere?: number[];
  parentError?: number | null;
  parentSphere?: number[] | null;
  group?: number | null;
  source?: number | null;
};
/** Centre d'une sphère dans le repère de `e`, écrit dans un tampon partagé : rien n'est alloué,
 *  et la valeur ne survit pas à l'appel suivant. */
const centre = new Float64Array(3);
export function projectCentre(sphere: ArrayLike<number>, offset: number, e: ArrayLike<number>) {
  const cx = sphere[offset],
    cy = sphere[offset + 1],
    cz = sphere[offset + 2];
  centre[0] = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
  centre[1] = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
  centre[2] = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
  return centre;
}
/** Projected screen error of one (error, object-space sphere) pair, in the frame given by `e`. */
export function projectedClusterError(
  error: number | null | undefined,
  sphere: ArrayLike<number> | null | undefined,
  offset: number,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
) {
  // Exact geometry and clusters with no replacement need no projection at all, which is most of them.
  if (error === 0) return 0;
  if (error == null || error === Infinity) return Infinity;
  if (!sphere) return Infinity;
  const c = projectCentre(sphere, offset, e);
  return clusterErrorPixels(error, stretch, c[0], c[1], c[2], sphere[offset + 3], focal, near);
}
export function cutSelects(
  rec: ClusterCut,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
  pixelError: number,
) {
  if (projectedClusterError(rec.lodError ?? 0, rec.sphere, 0, e, stretch, focal, near) > pixelError)
    return false;
  return (
    projectedClusterError(
      rec.parentError,
      rec.parentSphere ?? rec.sphere,
      0,
      e,
      stretch,
      focal,
      near,
    ) > pixelError
  );
}
/** Six frustum planes of `clip`, inward-facing, unnormalised: a point is inside when every ax+by+cz+d >= 0.
 *  Taken in the space `clip` maps from, so the caller never transforms a box. Allocation free. */
export function extractPlanes(clip: THREE.Matrix4, planes: Float64Array) {
  const m = clip.elements;
  const x0 = m[0],
    x1 = m[4],
    x2 = m[8],
    x3 = m[12];
  const y0 = m[1],
    y1 = m[5],
    y2 = m[9],
    y3 = m[13];
  const z0 = m[2],
    z1 = m[6],
    z2 = m[10],
    z3 = m[14];
  const w0 = m[3],
    w1 = m[7],
    w2 = m[11],
    w3 = m[15];
  planes[0] = w0 + x0;
  planes[1] = w1 + x1;
  planes[2] = w2 + x2;
  planes[3] = w3 + x3;
  planes[4] = w0 - x0;
  planes[5] = w1 - x1;
  planes[6] = w2 - x2;
  planes[7] = w3 - x3;
  planes[8] = w0 + y0;
  planes[9] = w1 + y1;
  planes[10] = w2 + y2;
  planes[11] = w3 + y3;
  planes[12] = w0 - y0;
  planes[13] = w1 - y1;
  planes[14] = w2 - y2;
  planes[15] = w3 - y3;
  planes[16] = w0 + z0;
  planes[17] = w1 + z1;
  planes[18] = w2 + z2;
  planes[19] = w3 + z3;
  planes[20] = w0 - z0;
  planes[21] = w1 - z1;
  planes[22] = w2 - z2;
  planes[23] = w3 - z3;
}
/** Les six coordonnées de la boîte, rangées pour que le signe du plan serve d'indice. */
const boite = new Float64Array(6);
/**
 * Axis-aligned box against the six planes: 0 outside, 1 straddling, 2 fully inside.
 * A subtree that is fully inside spares every box below it a test.
 *
 * Deux passes au lieu d'une : la première ne fait que rejeter, la seconde ne sert qu'à distinguer
 * « traversé » de « entièrement dedans » et s'arrête au premier plan traversé. Un plan qui rejette
 * n'a jamais besoin du second produit scalaire, et le test de l'accumulateur sort de la boucle
 * chaude. Le signe du plan choisit le sommet par indice plutôt que par branche. Les produits et les
 * sommes restent ceux d'avant, dans le même ordre : `a * maxX + b * maxY + c * maxZ + d`.
 */
export function boxClip(
  planes: Float64Array,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  boite[0] = minX;
  boite[1] = maxX;
  boite[2] = minY;
  boite[3] = maxY;
  boite[4] = minZ;
  boite[5] = maxZ;
  for (let p = 0; p < 24; p += 4) {
    const a = planes[p],
      b = planes[p + 1],
      c = planes[p + 2],
      d = planes[p + 3];
    if (a * boite[a > 0 ? 1 : 0] + b * boite[b > 0 ? 3 : 2] + c * boite[c > 0 ? 5 : 4] + d < 0)
      return 0;
  }
  for (let p = 0; p < 24; p += 4) {
    const a = planes[p],
      b = planes[p + 1],
      c = planes[p + 2],
      d = planes[p + 3];
    if (a * boite[a > 0 ? 0 : 1] + b * boite[b > 0 ? 2 : 3] + c * boite[c > 0 ? 4 : 5] + d < 0)
      return 1;
  }
  return 2;
}
/**
 * Plancher de l'erreur projetée d'un sous-arbre : l'erreur la plus faible qu'il porte, vue du point
 * le plus lointain que sa sphère englobante autorise, `centre` déjà projeté par `projectCentre`.
 * Jamais au-dessus de la valeur vraie d'un de ses clusters, donc utilisable pour décider d'un
 * sous-arbre entier sans le descendre.
 *
 * Preuve de la borne : une sphère (c_i, r_i) contenue dans (C, R) vérifie |c_i − C| ≤ R, donc après
 * une transformation qui étire d'au plus `stretch`, |vue(c_i)| ≤ |vue(C)| + R·stretch. La distance
 * qu'utilise `clusterErrorPixels` vaut |vue(c_i)| − r_i·stretch ≤ |vue(C)| + R·stretch, et l'erreur
 * projetée décroît avec la distance : diviser l'erreur minimale par cette distance maximale ne peut
 * pas dépasser la plus petite erreur projetée du sous-arbre.
 */
export function errorFloorPixels(
  error: number,
  stretch: number,
  centre: ArrayLike<number>,
  radius: number,
  focal: number,
) {
  if (error === 0) return 0;
  if (error === Infinity) return Infinity;
  // Sans sphère englobante, aucune borne à opposer : le plancher ne certifie rien.
  if (!(error > 0) || !(radius >= 0)) return 0;
  const vx = centre[0],
    vy = centre[1],
    vz = centre[2];
  const far = Math.sqrt(vx * vx + vy * vy + vz * vz) + radius * stretch;
  // Tout le sous-arbre est alors sur la caméra ou derrière : son erreur projetée est infinie.
  if (!(far > 0)) return Infinity;
  return (error * stretch * focal) / far;
}
