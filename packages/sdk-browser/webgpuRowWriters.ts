import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import { ROW_ID_BASE_WORD, ROW_HIZ_SLOT_WORD, packedRowBase } from './webgpuPageRow.ts';
import type { PageRec } from './pageSelection.ts';
import type { createPageRowWriter } from './webgpuPageRow.ts';
import type { createWebgpuRowState } from './webgpuRowState.ts';

type Rows = ReturnType<typeof createWebgpuRowState>;
type Writer = ReturnType<typeof createPageRowWriter>;

/**
 * Les deux seules façons dont un rang de la table de lignes change d'occupant : une page y est posée,
 * ou une ligne entière y est déplacée. Toutes deux tiennent à jour les tableaux parallèles qui disent
 * qui occupe quoi, et lèvent `state.changed` pour que l'image sache qu'elle doit renvoyer la table.
 */
export function createWebgpuRowWriters(rows: Rows, packedPages: PageRec[], writePageRow: Writer) {
  const rowWords = PAGE_INFO_STRIDE / 4;
  const state = { changed: false };

  /** Pose la page `page` au rang `row` : la ligne est écrite, donc déclarée sale, par l'écrivain. */
  const assign = (row: number, page: number, offsetWords: number) => {
    const rec = packedPages[page];
    rows.packedRecs[row] = rec;
    rows.packedPositions[row] = rows.pagePositions[page];
    rows.packedPageIndex[row] = page;
    rows.rowPageIndex[row] = page;
    rows.rowOffsetWords[row] = offsetWords;
    rows.rowEpoch[row] = rows.tableEpoch;
    rows.rowOfPage[page] = row;
    state.changed = true;
    writePageRow(
      rec,
      page,
      row,
      offsetWords,
      rec.array!,
      rows.pageTableFloats!,
      rows.pageTableInts!,
    );
  };

  /** Déplace la ligne `from` au rang `to` : les mots de la ligne, puis les deux qui SONT le rang. */
  const moveRow = (from: number, to: number) => {
    const ints = rows.pageTableInts!,
      page = rows.packedPageIndex[from],
      base = to * rowWords;
    rows.pageTableFloats!.copyWithin(base, from * rowWords, (from + 1) * rowWords);
    ints[base + ROW_ID_BASE_WORD] = packedRowBase(to);
    ints[base + ROW_HIZ_SLOT_WORD] = to;
    rows.packedRecs[to] = rows.packedRecs[from];
    rows.packedPositions[to] = rows.packedPositions[from];
    rows.packedPageIndex[to] = page;
    rows.rowPageIndex[to] = page;
    rows.rowOffsetWords[to] = rows.rowOffsetWords[from];
    rows.rowEpoch[to] = rows.rowEpoch[from];
    rows.rowOfPage[page] = to;
    rows.markRowDirty(to);
    state.changed = true;
  };

  return { assign, moveRow, state };
}
