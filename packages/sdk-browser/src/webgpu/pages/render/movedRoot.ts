import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts';
import { invalidateTemporalPyramid } from '../io/drops.ts';
import type { ClusterRoot } from '../../../page/selection/types.ts';
import type { PageRec } from '../../../page/selection/selection.ts';
import type { WebgpuPagesLayout } from '../prepare/layout.ts';

const ROW_WORDS = PAGE_INFO_STRIDE / 4;

/** What a moved root rewrites: its rows, the memos its world feeds, the temporal pyramid. */
export type MovedRootTarget = {
  layout: Pick<WebgpuPagesLayout, 'rows'>;
  run: Parameters<typeof invalidateTemporalPyramid>[0];
  blendState: { occlusionEpoch: number };
};

/**
 * The world of one placement moved: only what reads it follows. Its resident rows get their world
 * matrix — the only words of a row a pose writes (`../../row/pageRow.ts`) — and are declared dirty,
 * so the table, the corners, the draw items and the shadow spheres travel for them alone, and the
 * partition forgets their occlusion verdict (`../../visibility/corners.ts`) while the rest of the
 * scene keeps its own. Its windings are computed again. The temporal pyramid, one
 * image of the whole scene, no longer describes it. A transparent placement claims no row: the
 * transparent corners are sent again. Returns the rows rewritten.
 *
 * The table's age does not move: it rewrote every row, every corner and every transparent corner,
 * and dropped the whole scene's occlusion history, each image a model moved (#358).
 */
export function moveRootRows(rt: MovedRootTarget, root: ClusterRoot<PageRec>) {
  const { rows } = rt.layout,
    floats = rows.pageTableFloats;
  invalidateTemporalPyramid(rt.run);
  if (root.pages[0]?.transparent) rt.blendState.occlusionEpoch = -1;
  let rewritten = 0;
  for (const page of root.pages) {
    const index = page.packedIndex!;
    page.windingEpoch = undefined;
    const row = rows.rowOfPage[index];
    // A rank the CPU cut left behind may name another page since: only a row that is this page's.
    if (!floats || row < 0 || row >= rows.packedCount || rows.packedPageIndex[row] !== index)
      continue;
    floats.set(page.matrix.elements, row * ROW_WORDS);
    rows.markRowDirty(row);
    rewritten++;
  }
  return rewritten;
}
