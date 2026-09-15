import { errorFloorAt, projectedErrorAt, viewDistance } from './pageSelectionProjection.ts';
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
 * Le plancher et le plafond de l'erreur propre partagent la même sphère : une seule racine carrée
 * les porte tous les deux, et la sphère du remplaçant n'est projetée que si la décision en dépend
 * encore.
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
  const ownRadius = values[at + OWN_SPHERE + 3],
    ownDistance = viewDistance(values, at + OWN_SPHERE, e);
  // Aucun cluster du sous-arbre n'est assez fin : la coupe n'en prend aucun.
  if (errorFloorAt(values[at + OWN_FLOOR], ownDistance, ownRadius, stretch, focal) > limit)
    return -1;
  // Un cluster peut encore être trop grossier : on descend.
  if (
    projectedErrorAt(values[at + OWN_CEIL], ownDistance, ownRadius, stretch, focal, s.camera.near) >
    limit
  )
    return 0;
  // Tous sont assez fins ; la coupe les retient si aucun remplaçant ne les couvre encore.
  return errorFloorAt(
    values[at + PARENT_FLOOR],
    viewDistance(values, at + PARENT_SPHERE, e),
    values[at + PARENT_SPHERE + 3],
    stretch,
    focal,
  ) > limit
    ? 1
    : 0;
}

/** Le plancher d'un sous-arbre est-il strictement positif, sans le projeter ? Voir `nodeDecisionAtZero`. */
function floorAboveZero(values: Float64Array, error: number, radiusAt: number) {
  return error === Infinity || (error > 0 && values[radiusAt] >= 0);
}

/**
 * `nodeDecision` quand le seuil vaut zéro, sans rien projeter.
 *
 * Même identité que `cutSelectsAtZero` : une erreur projetée n'est jamais négative, donc « > 0 »
 * vaut « ≠ 0 », et les deux bornes ne rendent zéro que sur une erreur nulle — ou, pour le plancher,
 * sur une sphère absente, qui ne certifie rien. Le plafond, lui, ne passe sous zéro que s'il est
 * nul. Les décisions d'un nœud à seuil nul ne dépendent donc ni de la caméra ni des sphères, mais
 * seulement des bornes que la préparation a réduites. L'appelant ne prend ce chemin que lorsque
 * l'étirement, la focale et le plan proche de l'image sont finis et strictement positifs.
 *
 * L'identité tient sous l'invariant que `cullingBounds` maintient et que
 * `pageSelectionCutNode.test.ts` vérifie : une borne finie strictement positive vient d'un cluster
 * qui portait sa sphère, donc d'un rayon positif ou nul. Sur une borne positive sans sphère — que
 * la préparation ne produit pas —, le chemin général refuserait la donnée là où celui-ci descend.
 */
export function nodeDecisionAtZero(values: Float64Array, at: number) {
  if (floorAboveZero(values, values[at + OWN_FLOOR], at + OWN_SPHERE + 3)) return -1;
  if (values[at + OWN_CEIL] !== 0) return 0;
  return floorAboveZero(values, values[at + PARENT_FLOOR], at + PARENT_SPHERE + 3) ? 1 : 0;
}
