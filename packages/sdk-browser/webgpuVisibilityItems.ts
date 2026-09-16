import { HIZ_BOUNDS_VALUES } from './hiz.ts';
import { hizNearestBound } from './hizNearestBound.ts';
import { BASE_SLOTS, DRAW_ITEM_U32 } from './gpuDraw.ts';
import { ROW_INDEX_WORDS } from './webgpuPageRow.ts';
import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import { visBin } from './webgpuPagesPipelineFor.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Ce dont les fiches de dessin, les compteurs par bac et les bornes testées dépendent, et rien
 * d'autre : la table de lignes telle qu'elle est — son âge, son âge de rangs, son nombre de lignes,
 * et le fait qu'aucun octet de ligne n'ait changé —, la partition occulteurs/testés de cette image,
 * et le nombre de couches coplanaires que le dessin indirect adresse.
 *
 * Tout cela inchangé, les tableaux que la boucle écrirait porteraient déjà exactement ce qu'ils
 * portent : les fiches, les compteurs par bac et les bornes de la moitié testée restent en place.
 */
export function createVisibilityItemsHold() {
  return {
    armed: false,
    tableEpoch: -1,
    rowsEpoch: -1,
    packedCount: -1,
    restDigest: 0,
    occluders: -1,
    projectionGeneration: -1,
    twoPass: false,
    layerSlots: -1,
    occluderVertices: 0,
    restVertices: 0,
    testedCount: 0,
  };
}

/** Builds stable indirect draw items and the tested half's compact Hi-Z bounds; the time it took
 *  lands in `rt.timing.lastItemsMs`. */
export function buildWebgpuVisibilityItems(
  rt: WebgpuPagesRuntime,
  itemsDirty: boolean,
  partition: {
    occluders: number;
    twoPass: boolean;
    restDigest: number;
    projectionGeneration: number;
  },
) {
  const { twoPass, restDigest, occluders, projectionGeneration } = partition;
  const {
    rows,
    hizRest,
    drawItemWords,
    binInstances,
    drawRestBits,
    hizTestedBounds,
    hizBounds,
    hizTestedRows,
    hizTestedTriangles,
    itemsHold,
  } = rt.layout;
  const layerSlots = rt.vis.drawLayerSlots - 1;
  if (
    itemsHold.armed &&
    !itemsDirty &&
    rows.dirtyTo < rows.dirtyFrom &&
    itemsHold.tableEpoch === rows.tableEpoch &&
    itemsHold.rowsEpoch === rows.rowsEpoch &&
    itemsHold.packedCount === rows.packedCount &&
    itemsHold.restDigest === restDigest &&
    itemsHold.occluders === occluders &&
    itemsHold.projectionGeneration === projectionGeneration &&
    itemsHold.twoPass === twoPass &&
    itemsHold.layerSlots === layerSlots
  ) {
    rt.timing.lastItemsMs = 0;
    return itemsHold;
  }
  let occluderVertices = 0,
    restVertices = 0,
    testedCount = 0;
  drawRestBits.fill(0, 0, Math.ceil(Math.max(1, rows.packedCount) / 32));
  const itemsStart = performance.now();
  binInstances.fill(0);
  const packedRecs = rows.packedRecs,
    packedPageIndex = rows.packedPageIndex,
    pageTableInts = rows.pageTableInts!,
    rowWords = PAGE_INFO_STRIDE / 4;
  for (let i = 0; i < rows.packedCount; i++) {
    const row = i,
      rest = hizRest[i],
      word = i * DRAW_ITEM_U32;
    if (itemsDirty) {
      const rec = packedRecs[i]!;
      drawItemWords[word] = row;
      drawItemWords[word + 1] = visBin(rec);
      drawItemWords[word + 2] = packedPageIndex[i];
      // La couche coplanaire appartient à la ligne de la table, pas à l'image : elle voyage avec l'item.
      drawItemWords[word + 3] = Math.min(rec.depthLayer, layerSlots);
    }
    binInstances[drawItemWords[word + 1] + (rest ? 3 : 0) + BASE_SLOTS * drawItemWords[word + 3]]++;
    if (rest) drawRestBits[i >> 5] |= 1 << (i & 31);
    // Le compte d'indices est lu dans la ligne du tableau de pages, là où la carte le lit pour
    // dessiner : la ligne est réécrite chaque fois que la page change, si bien que ce mot est
    // exactement ce que l'image dessine — une lecture de tableau typé au lieu de deux indirections.
    const count = pageTableInts[i * rowWords + ROW_INDEX_WORDS];
    if (rest) restVertices += count;
    else occluderVertices += count;
    // Only the tested half travels to the GPU, each box naming the flag row it answers for.
    // Les bornes restent recopiées valeur par valeur : `set(subarray)` alloue une vue par boîte testée,
    // et six affectations coûtent moins que cette vue.
    if (twoPass && rest) {
      const from = i * HIZ_BOUNDS_VALUES,
        to = testedCount * HIZ_BOUNDS_VALUES;
      for (let k = 0; k < HIZ_BOUNDS_VALUES; k++) hizTestedBounds[to + k] = hizBounds[from + k];
      // La borne qui voyage jusqu'au noyau minore strictement ce que le cluster écrira : arrondi
      // dirigé vers le bas et biais de couche coplanaire retranché. Voir `hizNearestBound`.
      hizTestedBounds[to + 4] = hizNearestBound(hizBounds[from + 4], packedRecs[i]!.depthLayer);
      hizTestedTriangles[testedCount] = count / 3;
      hizTestedRows[testedCount++] = row;
    }
  }
  rt.timing.lastItemsMs = performance.now() - itemsStart;
  itemsHold.armed = true;
  itemsHold.tableEpoch = rows.tableEpoch;
  itemsHold.rowsEpoch = rows.rowsEpoch;
  itemsHold.packedCount = rows.packedCount;
  itemsHold.restDigest = restDigest;
  itemsHold.occluders = occluders;
  itemsHold.projectionGeneration = projectionGeneration;
  itemsHold.twoPass = twoPass;
  itemsHold.layerSlots = layerSlots;
  itemsHold.occluderVertices = occluderVertices;
  itemsHold.restVertices = restVertices;
  itemsHold.testedCount = testedCount;
  return itemsHold;
}
