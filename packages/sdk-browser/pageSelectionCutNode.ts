import { projectedClusterError, projectedErrorFloor } from './pageSelectionMath.ts';
import type { PageRecord, SelectionState } from './pageSelectionCutState.ts';
import {
  OWN_CEIL,
  OWN_FLOOR,
  OWN_SPHERE,
  PARENT_FLOOR,
  PARENT_SPHERE,
} from './pageSelectionCutBounds.ts';

/** Plafond de l'erreur projetée du sous-arbre : aucun de ses clusters ne projette au-dessus. */
function ceiling<T extends PageRecord>(
  s: SelectionState<T>,
  values: Float64Array,
  at: number,
  slot: number,
  sphere: number,
) {
  return projectedClusterError(
    values[at + slot],
    values,
    at + sphere,
    s.flatElements,
    s.flatStretch,
    s.flatFocal,
    s.camera.near,
  );
}

/** Plancher de l'erreur projetée du sous-arbre : aucun de ses clusters ne projette en dessous. */
function ground<T extends PageRecord>(
  s: SelectionState<T>,
  values: Float64Array,
  at: number,
  slot: number,
  sphere: number,
) {
  return projectedErrorFloor(
    values[at + slot],
    values,
    at + sphere,
    s.flatElements,
    s.flatStretch,
    s.flatFocal,
  );
}

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
  const limit = s.pixelError;
  // Aucun cluster du sous-arbre n'est assez fin : la coupe n'en prend aucun.
  if (ground(s, values, at, OWN_FLOOR, OWN_SPHERE) > limit) return -1;
  return ceiling(s, values, at, OWN_CEIL, OWN_SPHERE) <= limit &&
    ground(s, values, at, PARENT_FLOOR, PARENT_SPHERE) > limit
    ? 1
    : 0;
}
