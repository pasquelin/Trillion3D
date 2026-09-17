import type { PageRec } from './pageSelection.ts';
import type { CutDelta } from './webgpuCutDelta.ts';
import { createDenseKeySet } from './webgpuDenseKeys.ts';

export type CutCounts = ReturnType<typeof createCutCounts>;

/**
 * Les totaux de triangles du relevé de coupe, tenus d'une image à l'autre au lieu d'être resommés.
 *
 * `selectedTriangles` est la coupe dessinable entière, `uncoveredTriangles` le trou — une grappe que
 * le noyau veut dessiner et dont la ligne de résidence ou les octets manquent —, `drawnTriangles` ce
 * qui reste et part au dessin, `transparentTriangles` la part en mélange. Leur relation reste
 * `selected − drawn − uncovered = 0`, et c'est la seule façon honnête de dire le trou.
 *
 * Ils étaient resommés sur toute la coupe à chaque adoption, y compris quand l'image relisait le
 * relevé qu'elle tenait déjà. Ici ils ne bougent que de ce qui bouge : les pages que la différence
 * nomme, et celles dont la couverture vient de basculer — octets reçus ou perdus, ligne de résidence
 * prise ou rendue. Une image qui n'entre ni ne sort aucune page ne touche pas un compteur.
 *
 * L'appartenance est tenue ici plutôt que lue chez la différence : c'est elle qui dit si une page
 * dont la couverture bascule pèse sur le trou, et elle survit à l'image comme les totaux.
 */
export function createCutCounts(packedPages: readonly PageRec[], residentOffsetWords: Int32Array) {
  const capacity = Math.max(1, packedPages.length);
  const members = createDenseKeySet(capacity);
  /** Ce qui a été compté comme trou : ce qui a été ajouté est exactement ce qui sera retiré. */
  const holed = new Uint8Array(capacity);
  const totals = {
    selectedTriangles: 0,
    drawnTriangles: 0,
    uncoveredTriangles: 0,
    transparentTriangles: 0,
  };
  let selected = 0,
    uncovered = 0,
    transparent = 0;
  const publish = () => {
    totals.selectedTriangles = selected;
    totals.uncoveredTriangles = uncovered;
    // Une soustraction hors boucle, sur deux compteurs déjà tenus.
    totals.drawnTriangles = selected - uncovered;
    totals.transparentTriangles = transparent;
  };
  /** Remet la page à sa place dans le trou : membre sans ligne de résidence, ou sans octets. */
  const recount = (id: number) => {
    const rec = packedPages[id];
    if (!rec) return;
    const now = members.has(id) && (residentOffsetWords[id] < 0 || !rec.array) ? 1 : 0;
    if (now === holed[id]) return;
    holed[id] = now;
    uncovered += now ? rec.triangles : -rec.triangles;
  };
  return {
    totals,
    get count() {
      return members.count;
    },
    /** Une différence de la coupe dessinable : les sorties d'abord, les entrées ensuite. */
    apply(delta: CutDelta) {
      for (let i = 0; i < delta.exitedCount; i++) {
        const id = delta.exited[i],
          rec = packedPages[id];
        if (!rec || !members.remove(id)) continue;
        selected -= rec.triangles;
        if (rec.transparent) transparent -= rec.triangles;
        recount(id);
      }
      for (let i = 0; i < delta.enteredCount; i++) {
        const id = delta.entered[i],
          rec = packedPages[id];
        if (!rec || !members.add(id)) continue;
        selected += rec.triangles;
        if (rec.transparent) transparent += rec.triangles;
        recount(id);
      }
      publish();
      return totals;
    },
    /** La couverture d'une page vient de bouger ; hors de la coupe, elle ne pèse sur rien. */
    touch(id: number) {
      if (id < 0 || id >= capacity || !members.has(id)) return;
      recount(id);
      publish();
    },
    /** La coupe que ces totaux décrivaient ne décide plus l'image : tout repart de zéro. */
    clear() {
      for (let i = members.count - 1; i >= 0; i--) holed[members.list[i]] = 0;
      members.clear();
      selected = 0;
      uncovered = 0;
      transparent = 0;
      publish();
    },
  };
}
