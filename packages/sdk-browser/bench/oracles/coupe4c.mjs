// Oracles de la coupe WebGL2 d'avant le lot 4c : le chemin général, celui qui projette. Les tests
// unitaires les importent pour vérifier que les chemins à seuil nul rendent exactement la même
// décision, et que la distance partagée ne change pas un bit.
import { clusterErrorPixels } from '../../../sdk-core/index.ts';

/** `pageSelectionMath.ts` avant le lot 4c : le centre projeté dans un tampon partagé. */
const centre = new Float64Array(3);
export function referenceProjectCentre(sphere, offset, e) {
  const cx = sphere[offset],
    cy = sphere[offset + 1],
    cz = sphere[offset + 2];
  centre[0] = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
  centre[1] = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
  centre[2] = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
  return centre;
}

/** `projectedClusterError` d'avant le lot 4c : une racine carrée par borne, dans `clusterErrorPixels`. */
export function referenceProjectedClusterError(error, sphere, offset, e, stretch, focal, near) {
  if (error === 0) return 0;
  if (error == null || error === Infinity) return Infinity;
  if (!sphere) return Infinity;
  const c = referenceProjectCentre(sphere, offset, e);
  return clusterErrorPixels(error, stretch, c[0], c[1], c[2], sphere[offset + 3], focal, near);
}

/** `errorFloorPixels` d'avant le lot 4c, sur la profondeur que la borne corrigée du défaut 3
 *  utilise (`−vue(C).z`) là où l'ancienne prenait la distance à l'œil : le plancher reste le
 *  minorant d'un sous-arbre, la preuve est au site de `errorFloorAt`. */
export function referenceErrorFloorPixels(error, stretch, c, radius, focal) {
  if (error === 0) return 0;
  if (error === Infinity) return Infinity;
  if (!(error > 0) || !(radius >= 0)) return 0;
  const far = -c[2] + radius * stretch;
  if (!(far > 0)) return Infinity;
  return (error * stretch * focal) / far;
}

/** `cutSelects` d'avant le lot 4c : deux projections, quel que soit le seuil. */
export function referenceCutSelects(rec, e, stretch, focal, near, pixelError) {
  if (
    referenceProjectedClusterError(rec.lodError ?? 0, rec.sphere, 0, e, stretch, focal, near) >
    pixelError
  )
    return false;
  return (
    referenceProjectedClusterError(
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

/** `nodeDecision` d'avant le lot 4c, bornes lues aux mêmes décalages. */
export function referenceNodeDecision(values, at, slots, e, stretch, focal, near, limit) {
  const { ownFloor, ownCeil, parentFloor, ownSphere, parentSphere } = slots;
  const own = referenceProjectCentre(values, at + ownSphere, e),
    radius = values[at + ownSphere + 3];
  if (referenceErrorFloorPixels(values[at + ownFloor], stretch, own, radius, focal) > limit)
    return -1;
  if (
    clusterErrorPixels(values[at + ownCeil], stretch, own[0], own[1], own[2], radius, focal, near) >
    limit
  )
    return 0;
  const band = referenceProjectCentre(values, at + parentSphere, e);
  return referenceErrorFloorPixels(
    values[at + parentFloor],
    stretch,
    band,
    values[at + parentSphere + 3],
    focal,
  ) > limit
    ? 1
    : 0;
}
