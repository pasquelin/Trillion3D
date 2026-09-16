import { HIZ_BOUNDS_VALUES } from './hiz.ts';
import { hizNearestBound } from './hizNearestBound.ts';
import { BASE_SLOTS, DRAW_ITEM_U32 } from './gpuDraw.ts';
import { ROW_INDEX_WORDS } from './webgpuPageRow.ts';
import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import { visBin } from './webgpuPagesPipelineFor.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Ce que la tenue garde, en deux moitiés qui ne dépendent pas des mêmes choses.
 *
 * Les fiches de dessin, les compteurs par bac, les bits de moitié testée et les comptes de sommets
 * ne dépendent que de la table de lignes telle qu'elle est — son âge, son âge de rangs, son nombre
 * de lignes, et le fait qu'aucun octet de ligne n'ait changé —, de la partition occulteurs/testés
 * de cette image et du nombre de couches coplanaires que le dessin indirect adresse.
 *
 * Les bornes envoyées au test Hi-Z, elles, sont des rectangles d'ÉCRAN : elles dépendent en plus du
 * point de vue de l'image. Une caméra qui bouge sans changer la partition des pages laisse la
 * première moitié valide et retire la seconde ; sans cette distinction, l'image testerait les
 * rectangles de la caméra précédente et rejetterait des surfaces visibles.
 */
export function createVisibilityItemsHold() {
  return {
    armed: false,
    tableEpoch: -1,
    rowsEpoch: -1,
    packedCount: -1,
    restSignature: 0,
    twoPass: false,
    layerSlots: -1,
    occluderVertices: 0,
    restVertices: 0,
    testedCount: 0,
    /** Révision de vue et âge des rectangles d'écran à la copie des bornes tenues. */
    viewRevision: -1,
    projectionGeneration: -1,
  };
}

export type VisibilityItemsHold = ReturnType<typeof createVisibilityItemsHold>;

/** Builds stable indirect draw items and the tested half's compact Hi-Z bounds; the time it took
 *  lands in `rt.timing.lastItemsMs`. */
export function buildWebgpuVisibilityItems(
  rt: WebgpuPagesRuntime,
  twoPass: boolean,
  itemsDirty: boolean,
  restSignature: number,
) {
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
  const viewRevision = rt.run.revisions.view,
    projectionGeneration = rt.layout.hizProjection.generation;
  // La table, les fiches et les comptes tiennent tant que rien de ce dont ils dépendent n'a bougé.
  const tableHeld =
    itemsHold.armed &&
    !itemsDirty &&
    rows.dirtyTo < rows.dirtyFrom &&
    itemsHold.tableEpoch === rows.tableEpoch &&
    itemsHold.rowsEpoch === rows.rowsEpoch &&
    itemsHold.packedCount === rows.packedCount &&
    itemsHold.restSignature === restSignature &&
    itemsHold.twoPass === twoPass &&
    itemsHold.layerSlots === layerSlots;
  // Les bornes projetées tiennent en plus tant que le point de vue de l'image n'a pas bougé.
  if (
    tableHeld &&
    itemsHold.viewRevision === viewRevision &&
    itemsHold.projectionGeneration === projectionGeneration
  ) {
    rt.timing.lastItemsMs = 0;
    return itemsHold;
  }
  const packedRecs = rows.packedRecs,
    packedPageIndex = rows.packedPageIndex,
    pageTableInts = rows.pageTableInts!,
    rowWords = PAGE_INFO_STRIDE / 4;
  // Only the tested half travels to the GPU, each box naming the flag row it answers for.
  // Les bornes restent recopiées valeur par valeur : `set(subarray)` alloue une vue par boîte testée,
  // et six affectations coûtent moins que cette vue.
  const copyTestedBound = (i: number, slot: number, indices: number) => {
    const from = i * HIZ_BOUNDS_VALUES,
      to = slot * HIZ_BOUNDS_VALUES;
    for (let k = 0; k < HIZ_BOUNDS_VALUES; k++) hizTestedBounds[to + k] = hizBounds[from + k];
    // La borne qui voyage jusqu'au noyau minore strictement ce que le cluster écrira : arrondi
    // dirigé vers le bas et biais de couche coplanaire retranché. Voir `hizNearestBound`.
    hizTestedBounds[to + 4] = hizNearestBound(hizBounds[from + 4], packedRecs[i]!.depthLayer);
    hizTestedTriangles[slot] = indices / 3;
    hizTestedRows[slot] = i;
  };
  // Le compte d'indices est lu dans la ligne du tableau de pages, là où la carte le lit pour
  // dessiner : la ligne est réécrite chaque fois que la page change, si bien que ce mot est
  // exactement ce que l'image dessine — une lecture de tableau typé au lieu de deux indirections.
  const indicesOf = (i: number) => pageTableInts[i * rowWords + ROW_INDEX_WORDS];
  const itemsStart = performance.now();
  let occluderVertices = itemsHold.occluderVertices,
    restVertices = itemsHold.restVertices,
    testedCount = 0;
  if (tableHeld) {
    // Seuls les rectangles d'écran ont vieilli : on les recopie, sans toucher aux fiches ni aux bacs.
    if (twoPass)
      for (let i = 0; i < rows.packedCount; i++)
        if (hizRest[i]) copyTestedBound(i, testedCount++, indicesOf(i));
  } else {
    occluderVertices = 0;
    restVertices = 0;
    drawRestBits.fill(0, 0, Math.ceil(Math.max(1, rows.packedCount) / 32));
    binInstances.fill(0);
    for (let i = 0; i < rows.packedCount; i++) {
      const rest = hizRest[i],
        word = i * DRAW_ITEM_U32;
      if (itemsDirty) {
        const rec = packedRecs[i]!;
        drawItemWords[word] = i;
        drawItemWords[word + 1] = visBin(rec);
        drawItemWords[word + 2] = packedPageIndex[i];
        // La couche coplanaire appartient à la ligne de la table, pas à l'image : elle voyage avec l'item.
        drawItemWords[word + 3] = Math.min(rec.depthLayer, layerSlots);
      }
      binInstances[
        drawItemWords[word + 1] + (rest ? 3 : 0) + BASE_SLOTS * drawItemWords[word + 3]
      ]++;
      if (rest) drawRestBits[i >> 5] |= 1 << (i & 31);
      const count = indicesOf(i);
      if (rest) restVertices += count;
      else occluderVertices += count;
      if (twoPass && rest) copyTestedBound(i, testedCount++, count);
    }
  }
  rt.timing.lastItemsMs = performance.now() - itemsStart;
  itemsHold.armed = true;
  itemsHold.tableEpoch = rows.tableEpoch;
  itemsHold.rowsEpoch = rows.rowsEpoch;
  itemsHold.packedCount = rows.packedCount;
  itemsHold.restSignature = restSignature;
  itemsHold.twoPass = twoPass;
  itemsHold.layerSlots = layerSlots;
  itemsHold.occluderVertices = occluderVertices;
  itemsHold.restVertices = restVertices;
  itemsHold.testedCount = testedCount;
  itemsHold.viewRevision = viewRevision;
  itemsHold.projectionGeneration = projectionGeneration;
  return itemsHold;
}
