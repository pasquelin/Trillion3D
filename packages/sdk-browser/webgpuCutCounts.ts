import type { PageRec } from './pageSelection.ts';
import type { CutDelta } from './webgpuCutDelta.ts';

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
 * L'appartenance n'est pas retenue une seconde fois ici : c'est celle de la différence, qui la tient
 * déjà et à qui ces totaux sont attachés une fois pour toutes.
 */
export function createCutCounts(
  packedPages: readonly PageRec[],
  residentOffsetWords: Int32Array,
  delta: CutDelta,
) {
  const capacity = Math.max(1, packedPages.length);
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
  /** Vrai quand la page manque à l'image : pas de ligne de résidence, ou pas d'octets. */
  const holes = (id: number, rec: PageRec) => residentOffsetWords[id] < 0 || !rec.array;
  return {
    totals,
    /** La différence qui vient d'être appliquée : les sorties d'abord, les entrées ensuite. */
    apply() {
      // Les bornes sont lues UNE fois : ce sont des accesseurs, et les relire à chaque tour de
      // boucle coûtait plus que tout ce que la boucle fait.
      const exited = delta.exitedCount,
        entered = delta.enteredCount;
      const exits = delta.exited,
        entries = delta.entered;
      for (let i = 0; i < exited; i++) {
        const id = exits[i],
          rec = packedPages[id];
        selected -= rec.triangles;
        if (rec.transparent) transparent -= rec.triangles;
        if (holed[id]) {
          uncovered -= rec.triangles;
          holed[id] = 0;
        }
      }
      for (let i = 0; i < entered; i++) {
        const id = entries[i],
          rec = packedPages[id];
        selected += rec.triangles;
        if (rec.transparent) transparent += rec.triangles;
        if (holes(id, rec)) {
          uncovered += rec.triangles;
          holed[id] = 1;
        }
      }
      publish();
      return totals;
    },
    /** La couverture d'une page vient de bouger ; hors de la coupe, elle ne pèse sur rien. */
    touch(id: number) {
      if (!delta.has(id)) return;
      const rec = packedPages[id],
        now = holes(id, rec) ? 1 : 0;
      if (now === holed[id]) return;
      holed[id] = now;
      uncovered += now ? rec.triangles : -rec.triangles;
      publish();
    },
  };
}
