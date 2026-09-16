import type { PageRec } from './pageSelection.ts';
import type { createWebgpuResidencyMirror } from './webgpuResidencyMirror.ts';
import type { createWebgpuRowState } from './webgpuRowState.ts';
import type { createWebgpuRowCommit } from './webgpuRowCommit.ts';
import { createWebgpuRowSlots } from './webgpuRowSlots.ts';

type Rows = ReturnType<typeof createWebgpuRowState>;
type Mirror = ReturnType<typeof createWebgpuResidencyMirror>;
type Commit = ReturnType<typeof createWebgpuRowCommit>;

/** Keeps the drawable row table aligned with cache residency or a CPU-selected cut. */
export function createWebgpuRowSync(
  rows: Rows,
  mirror: Mirror,
  packedPages: PageRec[],
  drawn: PageRec[],
  drawSlots: number,
  cacheReady: () => boolean,
  { commitRows, sourceRowOf, writePageRow }: Commit,
  /** Appelée quand une page entre dans la résidence ou en sort, avant que la ligne ne change. */
  onResidenceChange: (rec: PageRec) => void = () => {},
) {
  const slots = createWebgpuRowSlots(rows, packedPages, drawSlots, writePageRow, onResidenceChange);
  /**
   * Rows for the drawable set. Ce que l'image doit à la table ne dépend plus que des pages dont le
   * cache vient de changer l'emplacement : le catalogue entier n'est reparcouru qu'à une
   * reconstruction, que l'allocateur de rangs décide seul.
   */
  const syncRows = () => {
    if (!cacheReady() || !rows.pageTableFloats) return;
    // Le journal ne décrit que cette passe-ci : ce qu'il nommait a déjà été appliqué ou abandonné.
    rows.clearResidencyChanges();
    mirror.sync();
    if (!mirror.dirty && !rows.touched.count && rows.rowsEpoch === rows.tableEpoch) return;
    mirror.dirty = false;
    rows.rowsEpoch = rows.tableEpoch;
    slots.apply();
  };
  /** The CPU cut names its own pages, so its rows are its order; the cut is rebuilt every frame. */
  const syncRowsFromCut = () => {
    if (!cacheReady() || !rows.pageTableFloats) return;
    mirror.sync();
    // The CPU cut names its own rows, so this path never skips: `mirror.dirty` belongs to the ranks.
    mirror.dirty = true;
    let count = 0,
      lastSource = -1,
      monotone = true;
    for (let i = 0; i < drawn.length && count < drawSlots; i++) {
      const rec = drawn[i];
      if (rec.transparent) continue;
      const pageIndex = rows.pageIndexOf(rec);
      if (pageIndex === undefined) continue;
      const offsetWords = rows.residentOffsetWords[pageIndex],
        index = rec.array,
        position = rows.pagePositions[pageIndex];
      if (offsetWords < 0 || !index || !position) continue;
      const row = count++;
      const source = sourceRowOf(pageIndex, offsetWords);
      if (source >= 0) {
        if (source <= lastSource) monotone = false;
        lastSource = source;
      }
      rows.newRowPage[row] = pageIndex;
      rows.newRowSource[row] = source;
      rows.packedRecs[row] = rec;
      rows.packedPositions[row] = position;
      rows.packedPageIndex[row] = pageIndex;
    }
    commitRows(count, monotone);
  };
  return { syncRows, syncRowsFromCut };
}
