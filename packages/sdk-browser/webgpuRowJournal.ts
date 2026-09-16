/**
 * Nombre de pages qu'une passe peut nommer avant qu'un parcours du catalogue ne coûte moins que
 * leur tri. Au-delà, la liste déborde et la synchronisation des rangs se reconstruit d'un bloc.
 */
const TOUCHED_SLOTS = 128;

/**
 * Les deux listes bornées qui pilotent la table de lignes.
 *
 * `touched` nomme les pages dont la résidence ou l'emplacement dans le cache vient de bouger :
 * c'est la seule entrée de la synchronisation des rangs, qui ne parcourt donc plus le catalogue.
 * Elle déborde plutôt que de grandir — au-delà de `TOUCHED_SLOTS` pages nommées, tout reconstruire
 * coûte moins cher que de suivre chacune.
 *
 * `residencyChanges` est ce que la passe a effectivement changé : les pages dont le DRAPEAU de
 * résidence a basculé, dans l'ordre croissant. La sélection GPU n'écrit que leurs plages tant que
 * `sorted` tient ; un index qui revient en arrière la renvoie à toutes les pages.
 */
export function createWebgpuRowJournal(pageCount: number) {
  const residencyChanges = { pages: new Int32Array(pageCount), count: 0, sorted: true };
  const noteResidencyChange = (page: number) => {
    if (residencyChanges.count && residencyChanges.pages[residencyChanges.count - 1] >= page)
      residencyChanges.sorted = false;
    if (residencyChanges.count < residencyChanges.pages.length)
      residencyChanges.pages[residencyChanges.count++] = page;
    else residencyChanges.sorted = false;
  };
  const clearResidencyChanges = () => {
    residencyChanges.count = 0;
    residencyChanges.sorted = true;
  };
  const touched = {
    pages: new Int32Array(Math.max(1, Math.min(pageCount, TOUCHED_SLOTS))),
    count: 0,
    overflow: false,
  };
  const touchPage = (page: number) => {
    if (touched.count < touched.pages.length) touched.pages[touched.count++] = page;
    else touched.overflow = true;
  };
  const clearTouched = () => {
    touched.count = 0;
    touched.overflow = false;
  };
  return {
    residencyChanges,
    noteResidencyChange,
    clearResidencyChanges,
    touched,
    touchPage,
    clearTouched,
  };
}
