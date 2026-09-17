import { sortPages } from '../sdk-core/index.ts';
import { createDenseKeySet } from './webgpuDenseKeys.ts';

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
  const changed = createDenseKeySet(pageCount);
  const residencyChanges = {
    pages: changed.list,
    get count() {
      return changed.count;
    },
    sorted: true,
  };
  /** Range le journal : la sélection GPU lit des plages, donc des index qui montent. */
  const sortResidencyChanges = () => {
    sortPages(changed.list, changed.count);
  };
  const clearResidencyChanges = () => {
    changed.clear();
    residencyChanges.sorted = true;
  };
  const touchedSet = createDenseKeySet(pageCount);
  const touched = {
    pages: touchedSet.list,
    get count() {
      return touchedSet.count;
    },
  };
  /**
   * Qui d'autre veut savoir qu'une page vient d'être nommée. `touchPage` est le seul endroit par où
   * passent les trois façons dont la couverture d'une grappe bascule — octets reçus, octets rendus,
   * emplacement de cache pris ou rendu —, si bien que les totaux de la coupe s'y raccrochent sans
   * qu'une liste soit parcourue une fois de plus. Prévenus à chaque appel, doublons compris : ce
   * qu'il fait est idempotent, et une bascule dans les deux sens ne doit pas passer inaperçue. Un
   * seul, car la publication de coupe est unique : une liste d'abonnés ferait croire le contraire.
   */
  let watcher: ((page: number) => void) | undefined;
  const touchPage = (page: number) => {
    touchedSet.add(page);
    if (watcher) watcher(page);
  };
  return {
    residencyChanges,
    noteResidencyChange: (page: number) => void changed.add(page),
    sortResidencyChanges,
    clearResidencyChanges,
    touched,
    touchPage,
    watchTouched: (abonne: (page: number) => void) => void (watcher = abonne),
    clearTouched: touchedSet.clear,
  };
}
