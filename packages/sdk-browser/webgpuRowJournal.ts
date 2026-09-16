/**
 * Les deux listes qui pilotent la table de lignes.
 *
 * `touched` nomme les pages dont la résidence ou l'emplacement dans le cache vient de bouger :
 * c'est la seule entrée de la synchronisation des rangs, qui ne parcourt donc plus le catalogue.
 * Elle a la taille du catalogue et un marquage par page, si bien qu'une page ne s'y inscrit qu'une
 * fois et qu'elle ne peut plus déborder : aucune rafale d'arrivées ne déclenche plus le parcours
 * des 124 000 pages qui coûtait le pic de l'image.
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
  const touchedMarks = new Uint8Array(Math.max(1, pageCount));
  const touched = { pages: new Int32Array(Math.max(1, pageCount)), count: 0 };
  const touchPage = (page: number) => {
    if (touchedMarks[page]) return;
    touchedMarks[page] = 1;
    touched.pages[touched.count++] = page;
  };
  const clearTouched = () => {
    for (let i = 0; i < touched.count; i++) touchedMarks[touched.pages[i]] = 0;
    touched.count = 0;
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
