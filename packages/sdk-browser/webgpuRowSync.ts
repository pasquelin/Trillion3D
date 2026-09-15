import type { PageRec } from './pageSelection.ts';
import type { createWebgpuResidencyMirror } from './webgpuResidencyMirror.ts';
import type { createWebgpuRowState } from './webgpuRowState.ts';
import type { createWebgpuRowCommit } from './webgpuRowCommit.ts';

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
  { commitRows, sourceRowOf }: Commit,
  /** Appelée quand une page entre dans la résidence ou en sort, avant que la ligne ne change. */
  onResidenceChange: (rec: PageRec) => void = () => {},
) {
  /**
   * Rows for the drawable set. `residentFlags` keeps `pageSelection`'s predicate — CPU bytes present and
   * the cluster resident — read fresh from every page, so what may be drawn is never carried over from
   * an earlier image.
   */
  const syncRows = () => {
    if (!cacheReady() || !rows.pageTableFloats) return;
    // Le journal ne décrit que cette passe-ci : ce qu'il nommait a déjà été appliqué ou abandonné.
    rows.clearResidencyChanges();
    mirror.sync();
    if (!mirror.dirty && rows.rowsEpoch === rows.tableEpoch) return;
    mirror.dirty = false;
    rows.rowsEpoch = rows.tableEpoch;
    let count = 0,
      candidates = 0,
      overflow = 0,
      lastSource = -1,
      monotone = true;
    for (let i = 0; i < packedPages.length; i++) {
      const offsetWords = rows.residentOffsetWords[i],
        rec = packedPages[i],
        index = rec.array;
      const resident = offsetWords >= 0 && !!index;
      if (rows.residentFlags[i] !== (resident ? 1 : 0)) {
        rows.residentFlags[i] = resident ? 1 : 0;
        rows.noteResidencyChange(i);
        onResidenceChange(rec);
      }
      // Un cluster transparent est résident, demandé et budgété comme les autres, mais il ne réclame
      // pas de ligne du tampon de visibilité : il se dessine dans la passe de mélange.
      if (!resident || rec.transparent) continue;
      candidates++;
      const position = rows.pagePositions[i];
      if (!position) continue;
      if (count >= drawSlots) {
        overflow++;
        continue;
      }
      const row = count++;
      const source = sourceRowOf(i, offsetWords);
      if (source >= 0) {
        if (source <= lastSource) monotone = false;
        lastSource = source;
      }
      rows.newRowPage[row] = i;
      rows.newRowSource[row] = source;
      rows.packedRecs[row] = rec;
      rows.packedPositions[row] = position;
      rows.packedPageIndex[row] = i;
    }
    commitRows(count, monotone);
    rows.candidateCount = candidates;
    rows.candidateOverflow = overflow + Math.max(0, candidates - drawSlots);
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
