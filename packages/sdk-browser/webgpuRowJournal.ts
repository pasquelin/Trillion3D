import { sortPages } from '../sdk-core/index.ts';

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
 * résidence a basculé. La sélection GPU n'écrit que leurs plages tant que `sorted` tient, et la
 * liste est RANGÉE à la fin de la passe plutôt que remplie dans l'ordre : une page qui part et une
 * page qui arrive ne se nomment pas dans le même ordre, et exiger que les index montent renvoyait
 * la sélection au parcours des 124 000 pages dès qu'une passe mêlait les deux. Le marquage par page
 * interdit le doublon, donc la liste ne peut pas non plus déborder.
 */
export function createWebgpuRowJournal(pageCount: number) {
  const changedMarks = new Uint8Array(Math.max(1, pageCount));
  const residencyChanges = {
    pages: new Int32Array(Math.max(1, pageCount)),
    count: 0,
    sorted: true,
  };
  const noteResidencyChange = (page: number) => {
    if (changedMarks[page]) return;
    changedMarks[page] = 1;
    residencyChanges.pages[residencyChanges.count++] = page;
  };
  /** Range le journal : la sélection GPU lit des plages, donc des index qui montent. */
  const sortResidencyChanges = () => {
    sortPages(residencyChanges.pages, residencyChanges.count);
  };
  const clearResidencyChanges = () => {
    for (let i = 0; i < residencyChanges.count; i++) changedMarks[residencyChanges.pages[i]] = 0;
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
    sortResidencyChanges,
    clearResidencyChanges,
    touched,
    touchPage,
    clearTouched,
  };
}
