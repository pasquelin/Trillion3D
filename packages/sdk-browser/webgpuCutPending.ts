import type { PageRec } from './pageSelection.ts';
import type { CutDelta } from './webgpuCutDelta.ts';
import { createDenseKeySet } from './webgpuDenseKeys.ts';

export type CutPending = ReturnType<typeof createCutPending>;

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
 * `pages` est la liste de celles qui manquent, et elle seule est parcourue.
 */
export function createCutPending(packedPages: readonly PageRec[]) {
  const capacity = Math.max(1, packedPages.length);
  const members = createDenseKeySet(capacity),
    missing = createDenseKeySet(capacity);
  const note = (id: number) => {
    const rec = packedPages[id];
    if (!rec) return;
    if (rec.array) missing.remove(id);
    else missing.add(id);
  };
  return {
    /** Les rangs de page encore attendus, et leur nombre : l'image tenue ne lit que ce nombre. */
    get count() {
      return missing.count;
    },
    get pages() {
      return missing.list;
    },
    /** Une différence de la coupe demandée : les sorties d'abord, les entrées ensuite. */
    apply(delta: CutDelta) {
      for (let i = 0; i < delta.exitedCount; i++) {
        const id = delta.exited[i];
        if (members.remove(id)) missing.remove(id);
      }
      for (let i = 0; i < delta.enteredCount; i++) {
        const id = delta.entered[i];
        if (members.add(id)) note(id);
      }
    },
    /** Les octets d'une page viennent d'arriver ou de partir ; hors de la coupe, rien à en dire. */
    touch(id: number) {
      if (id >= 0 && id < capacity && members.has(id)) note(id);
    },
    /** La coupe que cet ensemble décrivait ne décide plus l'image. */
    clear() {
      members.clear();
      missing.clear();
    },
  };
}
