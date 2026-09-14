import { clusterErrorPixels } from '../sdk-core/index.ts';
import { errorFloorPixels, projectCentre } from './pageSelectionMath.ts';
import type { PageRecord, SelectionState } from './pageSelectionCutState.ts';
import {
  OWN_CEIL,
  OWN_FLOOR,
  OWN_SPHERE,
  PARENT_FLOOR,
  PARENT_SPHERE,
} from './pageSelectionCutBounds.ts';

/**
 * Décision de coupe d'un sous-arbre entier : -1 rejet, 1 acceptation, 0 indécis.
 *
 * Le test par cluster retient un cluster assez fin que son remplaçant ne couvre plus. Les deux
 * membres se bornent séparément : un plafond sous le seuil vaut pour tout le sous-arbre, un
 * plancher au-dessus du seuil aussi. Rejeter demande qu'un des deux membres soit faux partout,
 * accepter que les deux soient vrais partout ; entre les deux on descend, et la décision rendue
 * est celle qu'aurait rendue la descente complète.
 *
 * Le rejet que le manifeste permet déjà — aucun remplaçant encore trop grossier dans le sous-arbre —
 * reste posé par l'appelant, avec les bornes du manifeste et sur les deux passes.
 */
export function nodeDecision<T extends PageRecord>(
  s: SelectionState<T>,
  values: Float64Array,
  at: number,
) {
  const limit = s.pixelError,
    e = s.flatElements,
    stretch = s.flatStretch,
    focal = s.flatFocal;
  // La sphère propre n'est projetée qu'une fois : plancher et plafond en dérivent tous deux.
  const own = projectCentre(values, at + OWN_SPHERE, e),
    radius = values[at + OWN_SPHERE + 3];
  // Aucun cluster du sous-arbre n'est assez fin : la coupe n'en prend aucun.
  if (errorFloorPixels(values[at + OWN_FLOOR], stretch, own, radius, focal) > limit) return -1;
  // Un cluster peut encore être trop grossier : on descend.
  if (
    clusterErrorPixels(
      values[at + OWN_CEIL],
      stretch,
      own[0],
      own[1],
      own[2],
      radius,
      focal,
      s.camera.near,
    ) > limit
  )
    return 0;
  // Tous sont assez fins ; la coupe les retient si aucun remplaçant ne les couvre encore.
  const band = projectCentre(values, at + PARENT_SPHERE, e);
  return errorFloorPixels(
    values[at + PARENT_FLOOR],
    stretch,
    band,
    values[at + PARENT_SPHERE + 3],
    focal,
  ) > limit
    ? 1
    : 0;
}
