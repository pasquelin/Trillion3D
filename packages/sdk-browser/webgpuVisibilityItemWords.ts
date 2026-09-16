import { DRAW_ITEM_U32 } from './gpuDraw.ts';
import { visBin } from './webgpuPagesPipelineFor.ts';
import type { GpuDraw } from './gpuDraw.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Les quatre mots d'une fiche de dessin — la ligne, son bac de pipeline, son index de page dans le
 * catalogue et sa couche coplanaire — sont des propriétés de la LIGNE, pas de l'image. Une caméra
 * qui bouge n'en change aucun ; seule une page qui arrive, qui part ou qui change de rang le fait,
 * et la table de lignes nomme déjà cet intervalle-là (`rows.dirtyFrom`, `rows.dirtyTo`).
 *
 * Ce témoin garde donc les mots d'une image à l'autre et n'accumule que la plage contiguë que la
 * carte n'a pas encore reçue. La boucle par image ne les reconstruit plus : elle les relit.
 */
export function createDrawItemWordsHold() {
  return { layerSlots: -1, target: undefined as GpuDraw | undefined, from: 0, to: -1 };
}
export type DrawItemWordsHold = ReturnType<typeof createDrawItemWordsHold>;

/**
 * Réécrit les mots des lignes que la table vient de déclarer sales, et élargit d'autant la plage
 * restant à téléverser. Un plafond de couches coplanaires nouveau, ou un tampon de compaction neuf
 * dont les octets ne sont pas les nôtres, redemandent toute la table : dans les deux cas ce que la
 * carte tient ne décrit plus rien.
 */
export function refreshDrawItemWords(
  rt: WebgpuPagesRuntime,
  layerSlots: number,
  target: GpuDraw | undefined,
) {
  const { rows, drawItemWords, itemWordsHold: hold } = rt.layout;
  const last = rows.packedCount - 1;
  let from = rows.dirtyFrom,
    to = Math.min(rows.dirtyTo, last);
  if (hold.layerSlots !== layerSlots || hold.target !== target) {
    hold.layerSlots = layerSlots;
    hold.target = target;
    from = 0;
    to = last;
  }
  for (let row = from; row <= to; row++) {
    const rec = rows.packedRecs[row]!,
      word = row * DRAW_ITEM_U32;
    drawItemWords[word] = row;
    drawItemWords[word + 1] = visBin(rec);
    drawItemWords[word + 2] = rows.packedPageIndex[row];
    // La couche coplanaire appartient à la ligne de la table, pas à l'image : elle voyage avec l'item.
    drawItemWords[word + 3] = Math.min(rec.depthLayer, layerSlots);
  }
  if (to >= from) {
    hold.from = hold.to < hold.from ? from : Math.min(hold.from, from);
    hold.to = Math.max(hold.to, to);
  }
  return hold;
}

/** Les mots de la plage viennent d'être envoyés : plus rien n'est en attente. */
export function clearDrawItemWords(hold: DrawItemWordsHold) {
  hold.from = 0;
  hold.to = -1;
}
