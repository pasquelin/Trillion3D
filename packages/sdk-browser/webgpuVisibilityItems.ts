import { HIZ_BOUNDS_VALUES } from './hiz.ts';
import { DRAW_ITEM_U32 } from './gpuDraw.ts';
import { visBin } from './webgpuPagesPipelineFor.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Builds stable indirect draw items and the tested half's compact Hi-Z bounds; the time it took
 *  lands in `rt.timing.lastItemsMs`. */
export function buildWebgpuVisibilityItems(
  rt: WebgpuPagesRuntime,
  twoPass: boolean,
  itemsDirty: boolean,
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
  } = rt.layout;
  let occluderVertices = 0,
    restVertices = 0,
    testedCount = 0;
  drawRestBits.fill(0, 0, Math.ceil(Math.max(1, rows.packedCount) / 32));
  const itemsStart = performance.now();
  binInstances.fill(0);
  for (let i = 0; i < rows.packedCount; i++) {
    const row = i,
      rest = hizRest[i],
      word = i * DRAW_ITEM_U32;
    if (itemsDirty) {
      drawItemWords[word] = row;
      drawItemWords[word + 1] = visBin(rows.packedRecs[i]!);
      drawItemWords[word + 2] = rows.packedPageIndex[i];
      drawItemWords[word + 3] = 0;
    }
    binInstances[drawItemWords[word + 1] + (rest ? 3 : 0)]++;
    if (rest) drawRestBits[i >> 5] |= 1 << (i & 31);
    const count = rows.packedRecs[i]!.array!.length;
    if (rest) restVertices += count;
    else occluderVertices += count;
    // Only the tested half travels to the GPU, each box naming the flag row it answers for.
    if (twoPass && rest) {
      const from = i * HIZ_BOUNDS_VALUES,
        to = testedCount * HIZ_BOUNDS_VALUES;
      for (let k = 0; k < HIZ_BOUNDS_VALUES; k++) hizTestedBounds[to + k] = hizBounds[from + k];
      hizTestedRows[testedCount++] = row;
    }
  }
  rt.timing.lastItemsMs = performance.now() - itemsStart;
  return { occluderVertices, restVertices, testedCount };
}
