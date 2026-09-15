// Oracles du lot F, côté transparents et items de visibilité : `webgpuBlendSelection.ts:48` et
// `webgpuVisibilityItems.ts:30-53` d'avant le lot F, recopiés tels quels.
import { HIZ_BOUNDS_VALUES } from '../../hiz.ts';
import { BASE_SLOTS, DRAW_ITEM_U32 } from '../../gpuDraw.ts';
import { visBin } from '../../webgpuPagesPipelineFor.ts';

/** `webgpuVisibilityItems.ts` avant le lot F : l'enregistrement était relu trois fois par ligne. */
export function referenceBuildItems(rt, twoPass, itemsDirty) {
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
  } = rt.layout;
  let occluderVertices = 0,
    restVertices = 0,
    testedCount = 0;
  drawRestBits.fill(0, 0, Math.ceil(Math.max(1, rows.packedCount) / 32));
  binInstances.fill(0);
  for (let i = 0; i < rows.packedCount; i++) {
    const row = i,
      rest = hizRest[i],
      word = i * DRAW_ITEM_U32;
    if (itemsDirty) {
      drawItemWords[word] = row;
      drawItemWords[word + 1] = visBin(rows.packedRecs[i]);
      drawItemWords[word + 2] = rows.packedPageIndex[i];
      drawItemWords[word + 3] = Math.min(rows.packedRecs[i].depthLayer, rt.vis.drawLayerSlots - 1);
    }
    binInstances[drawItemWords[word + 1] + (rest ? 3 : 0) + BASE_SLOTS * drawItemWords[word + 3]]++;
    if (rest) drawRestBits[i >> 5] |= 1 << (i & 31);
    const count = rows.packedRecs[i].array.length;
    if (rest) restVertices += count;
    else occluderVertices += count;
    if (twoPass && rest) {
      const from = i * HIZ_BOUNDS_VALUES,
        to = testedCount * HIZ_BOUNDS_VALUES;
      for (let k = 0; k < HIZ_BOUNDS_VALUES; k++) hizTestedBounds[to + k] = hizBounds[from + k];
      hizTestedTriangles[testedCount] = count / 3;
      hizTestedRows[testedCount++] = row;
    }
  }
  return { occluderVertices, restVertices, testedCount };
}
