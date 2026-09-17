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
 * `records` est la liste des fiches qui manquent, et elle seule est parcourue : la règle qui en tire
 * des adresses est celle de tout le monde (`collectPendingUrls`), pas une recopie. L'appartenance à
 * la coupe est celle de la différence, à qui cet ensemble est attaché une fois pour toutes.
 */
export function createCutPending(packedPages: readonly PageRec[], delta: CutDelta) {
  /** Les fiches des pages qui manquent, tenues au rang de leur clé par l'ensemble lui-même. */
  const records: PageRec[] = [];
  const missing = createDenseKeySet(packedPages.length, records);
  /** Les rangs de l'ensemble : lus à même le tableau, l'appel est réservé à ce qui bouge. */
  const slots = missing.slots;
  return {
    /** Les fiches encore attendues, et leur nombre : l'image tenue ne lit que ce nombre. */
    records,
    get count() {
      return missing.count;
    },
    /** La différence qui vient d'être appliquée : les sorties d'abord, les entrées ensuite. */
    apply() {
      const exits = delta.exited,
        entries = delta.entered;
      for (let i = 0; i < delta.exitedCount; i++) {
        const id = exits[i];
        if (slots[id] >= 0) missing.remove(id);
      }
      for (let i = 0; i < delta.enteredCount; i++) {
        const id = entries[i];
        const rec = packedPages[id];
        if (!rec.array && slots[id] < 0) missing.add(id, rec);
      }
    },
    /** Les octets d'une page viennent d'arriver ou de partir ; hors de la coupe, rien à en dire. */
    touch(id: number) {
      if (!delta.has(id)) return;
      const rec = packedPages[id];
      if (rec.array) missing.remove(id);
      else missing.add(id, rec);
    },
  };
}
