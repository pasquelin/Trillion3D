import type { PageRec } from './pageSelection.ts';
import type { CutDelta } from './webgpuCutDelta.ts';
import { createDenseKeySet } from './webgpuDenseKeys.ts';

/**
 * Les pages de la coupe demandée qui n'ont pas encore leurs octets, tenues d'une image à l'autre.
 *
 * Deux lecteurs en vivent, et tous deux parcouraient la coupe entière pour n'en tirer, presque
 * toujours, rien : l'image tenue, qui refuse de tenir tant qu'une page attendue peut encore changer
 * la coupe, et la liste des adresses que l'hôte doit aller chercher. Quinze mille enregistrements
 * relus par image pour répondre « aucune ».
 *
 * L'ensemble ne bouge ici que de ce qui bouge : les pages que la différence de la coupe nomme, et
 * celles dont les octets viennent d'arriver ou de partir — que le journal des rangs nomme déjà.
 * `pages` est la liste de celles qui manquent, et elle seule est parcourue. L'appartenance à la
 * coupe est celle de la différence, à qui cet ensemble est attaché une fois pour toutes.
 */
export function createCutPending(packedPages: readonly PageRec[], delta: CutDelta) {
  const missing = createDenseKeySet(packedPages.length);
  /** Les rangs de l'ensemble : lus à même le tableau, l'appel est réservé à ce qui bouge. */
  const slots = missing.slots;
  return {
    /** Les rangs de page encore attendus, et leur nombre : l'image tenue ne lit que ce nombre. */
    get count() {
      return missing.count;
    },
    get pages() {
      return missing.list;
    },
    /** La différence qui vient d'être appliquée : les sorties d'abord, les entrées ensuite. */
    apply() {
      // Les bornes sont lues UNE fois : ce sont des accesseurs, et les relire à chaque tour de
      // boucle coûtait plus que tout ce que la boucle fait.
      const exited = delta.exitedCount,
        entered = delta.enteredCount;
      const exits = delta.exited,
        entries = delta.entered;
      for (let i = 0; i < exited; i++) {
        const id = exits[i];
        if (slots[id] >= 0) missing.remove(id);
      }
      for (let i = 0; i < entered; i++) {
        const id = entries[i];
        if (!packedPages[id].array && slots[id] < 0) missing.add(id);
      }
    },
    /** Les octets d'une page viennent d'arriver ou de partir ; hors de la coupe, rien à en dire. */
    touch(id: number) {
      if (!delta.has(id)) return;
      if (packedPages[id].array) missing.remove(id);
      else missing.add(id);
    },
  };
}
