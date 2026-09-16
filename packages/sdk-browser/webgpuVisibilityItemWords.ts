import { DRAW_ITEM_U32 } from './gpuDraw.ts';
import { ROW_INDEX_WORDS } from './webgpuPageRow.ts';
import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import { visBin } from './webgpuPagesPipelineFor.ts';
import { dirtyRange } from './webgpuRowState.ts';
import type { GpuDraw } from './gpuDraw.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Les cinq mots d'une fiche de dessin — la ligne, son bac de pipeline, son index de page dans le
 * catalogue, sa couche coplanaire et ses triangles — sont des propriétés de la LIGNE, pas de
 * l'image. Une caméra qui bouge n'en change aucun ; seule une page qui arrive, qui part ou qui
 * change de rang le fait, et la table de lignes nomme déjà cet intervalle-là (`rows.dirtyFrom`,
 * `rows.dirtyTo`).
 *
 * Ce témoin garde donc les mots d'une image à l'autre et n'accumule que la plage contiguë que la
 * carte n'a pas encore reçue. Il tient au passage le TOTAL des triangles des lignes dessinables, mis
 * à jour sur cette seule plage et sur les lignes qui entrent ou sortent du rang dessinable : c'est
 * ce que l'image soumet, exactement, sans qu'aucune image ne reparcoure les lignes résidentes.
 */
export function createDrawItemWordsHold(slots: number) {
  return {
    layerSlots: -1,
    target: undefined as GpuDraw | undefined,
    from: 0,
    to: -1,
    /** Triangles de chaque ligne, tels qu'ils sont entrés dans le total. */
    triangles: new Uint32Array(Math.max(1, slots)),
    /** Somme des triangles des lignes `[0, heldCount)`. */
    total: 0,
    heldCount: 0,
  };
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
  const rowWords = PAGE_INFO_STRIDE / 4,
    ints = rows.pageTableInts;
  // Les lignes qui viennent de sortir du rang dessinable quittent le total : une boucle bornée par
  // ce qui a changé, jamais par le nombre de lignes résidentes.
  for (let row = rows.packedCount; row < hold.heldCount; row++) {
    hold.total -= hold.triangles[row];
    hold.triangles[row] = 0;
  }
  // Une ligne qui entre dans le rang dessinable y entre avec ses mots : elle est sale, ou elle vient
  // d'être écrite. Élargir la plage jusqu'à elle coûte ce que le rang a grandi, et rien de plus.
  const stale = hold.layerSlots !== layerSlots || hold.target !== target;
  if (stale) {
    hold.layerSlots = layerSlots;
    hold.target = target;
  }
  const { from, to } = dirtyRange(rows, stale, hold.heldCount);
  for (let row = from; row <= to; row++) {
    const rec = rows.packedRecs[row]!,
      word = row * DRAW_ITEM_U32;
    drawItemWords[word] = row;
    drawItemWords[word + 1] = visBin(rec);
    drawItemWords[word + 2] = rows.packedPageIndex[row];
    // La couche coplanaire appartient à la ligne de la table, pas à l'image : elle voyage avec l'item.
    drawItemWords[word + 3] = Math.min(rec.depthLayer, layerSlots);
    // Les triangles que la ligne dessine sont ceux de sa ligne du tableau de pages — ce que la carte
    // dessine vraiment —, et non ceux que le cluster déclare. La partition GPU pèse un rejet
    // d'occultation avec, et le total de la table s'en déduit sans parcours par image.
    const triangles = ints ? ints[row * rowWords + ROW_INDEX_WORDS] / 3 : 0;
    drawItemWords[word + 4] = triangles;
    hold.total += triangles - hold.triangles[row];
    hold.triangles[row] = triangles;
  }
  hold.heldCount = rows.packedCount;
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
