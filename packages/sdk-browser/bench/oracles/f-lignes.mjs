// Oracles du lot F, côté table des lignes : `webgpuRowState.ts:5-14,46`, `webgpuRowCommit.ts:91-97`
// et `webgpuRowSync.ts:79` d'avant le lot F, recopiés tels quels.
import { PAGE_INFO_STRIDE, VIS_TRIANGLE_BITS } from '../../visibilityBuffer.ts';
import { ROW_ID_BASE_WORD, ROW_HIZ_SLOT_WORD } from '../../webgpuPageRow.ts';
import { createWebgpuRowJournal } from '../../webgpuRowJournal.ts';

/** L'état des lignes avant le lot F : le rang d'une page vivait dans une table de hachage. */
export function referenceRowState(packedPages, drawSlots) {
  const pageIndexByRec = new Map();
  for (let i = 0; i < packedPages.length; i++) pageIndexByRec.set(packedPages[i], i);
  // Le journal des pages nommées et des résidences qui ont bougé pendant la passe : postérieur au
  // lot F, il ne relève pas de l'optimisation que cet oracle départage, et il est repris tel quel
  // pour que la synchronisation des rangs, partagée, s'exécute des deux côtés à l'identique.
  const journal = createWebgpuRowJournal(packedPages.length);
  const etat = {
    ...journal,
    residentFlags: new Uint32Array(packedPages.length),
    residentOffsetWords: new Int32Array(packedPages.length).fill(-1),
    rowPageIndex: new Int32Array(drawSlots).fill(-1),
    rowOffsetWords: new Int32Array(drawSlots).fill(-1),
    rowEpoch: new Int32Array(drawSlots),
    packedPageIndex: new Int32Array(drawSlots),
    newRowPage: new Int32Array(drawSlots),
    newRowSource: new Int32Array(drawSlots),
    rowOfPage: new Int32Array(packedPages.length).fill(-1),
    rowRewrites: new Int32Array(drawSlots),
    packedRecs: new Array(drawSlots).fill(undefined),
    packedPositions: new Array(drawSlots).fill(undefined),
    pagePositions: new Array(packedPages.length).fill(undefined),
    rowCount: 0,
    tableEpoch: 1,
    rowsEpoch: 0,
    dirtyFrom: drawSlots,
    dirtyTo: -1,
    candidateCount: 0,
    candidateOverflow: 0,
    packedCount: 0,
    rowsChanged: true,
    // L'âge de l'allocateur de rangs, lui aussi postérieur au lot F.
    rowsRevision: 0,
    pageTableFloats: undefined,
    pageTableInts: undefined,
    pageIndexOf: (rec) => pageIndexByRec.get(rec),
    markRowDirty(row) {
      if (row < etat.dirtyFrom) etat.dirtyFrom = row;
      if (row > etat.dirtyTo) etat.dirtyTo = row;
    },
  };
  return etat;
}

/** `webgpuRowCommit.ts` avant le lot F : la queue réécrivait les quatre tableaux ligne par ligne. */
export function referenceRowCommit(rows, writePageRow) {
  const commitRows = (count, monotone) => {
    const floats = rows.pageTableFloats,
      ints = rows.pageTableInts,
      rowWords = PAGE_INFO_STRIDE / 4;
    let rewrites = 0,
      moved = 0;
    const move = (start, end, delta) => {
      floats.copyWithin(start * rowWords, (start + delta) * rowWords, (end + delta + 1) * rowWords);
      for (let row = start; row <= end; row++) {
        const base = row * rowWords;
        ints[base + ROW_ID_BASE_WORD] = ((row + 1) << VIS_TRIANGLE_BITS) >>> 0;
        ints[base + ROW_HIZ_SLOT_WORD] = row;
      }
      rows.markRowDirty(start);
      rows.markRowDirty(end);
      moved += end - start + 1;
    };
    if (monotone)
      for (let pass = 0; pass < 2; pass++) {
        const negative = pass === 0;
        let start = -1,
          end = -1,
          delta = 0;
        const flush = () => {
          if (start >= 0) move(start, end, delta);
          start = -1;
        };
        for (let step = 0; step < count; step++) {
          const row = negative ? count - 1 - step : step;
          const source = rows.newRowSource[row],
            d = source >= 0 ? source - row : 0;
          const keep = source >= 0 && (negative ? d < 0 : d > 0);
          if (keep && start >= 0 && d === delta && row === (negative ? start - 1 : end + 1)) {
            if (negative) start = row;
            else end = row;
            continue;
          }
          flush();
          if (keep) {
            start = row;
            end = row;
            delta = d;
          }
        }
        flush();
      }
    for (let row = 0; row < count; row++)
      if (!(monotone && rows.newRowSource[row] >= 0)) rows.rowRewrites[rewrites++] = row;
    for (let r = 0; r < rewrites; r++) {
      const row = rows.rowRewrites[r],
        pageIndex = rows.newRowPage[row],
        rec = rows.packedRecs[row];
      writePageRow(
        rec,
        pageIndex,
        row,
        rows.residentOffsetWords[pageIndex],
        rec.array,
        rows.pageTableFloats,
        rows.pageTableInts,
      );
    }
    if (rewrites || moved) rows.rowsChanged = true;
    for (let row = 0; row < count; row++) {
      const pageIndex = rows.newRowPage[row];
      rows.rowPageIndex[row] = pageIndex;
      rows.rowOffsetWords[row] = rows.residentOffsetWords[pageIndex];
      rows.rowEpoch[row] = rows.tableEpoch;
      rows.rowOfPage[pageIndex] = row;
    }
    if (count !== rows.rowCount) rows.rowsChanged = true;
    rows.rowCount = count;
    rows.packedCount = count;
    // Postérieur au lot F, comme le journal : la coupe processeur a posé ses propres rangs, donc
    // l'allocateur incrémental repart du catalogue. Repris ici pour que les deux côtés avancent
    // ensemble.
    rows.rowsRevision++;
  };
  const sourceRowOf = (pageIndex, offsetWords) => {
    const source = rows.rowOfPage[pageIndex];
    if (source < 0 || source >= rows.rowCount || rows.rowPageIndex[source] !== pageIndex) return -1;
    return rows.rowOffsetWords[source] === offsetWords && rows.rowEpoch[source] === rows.tableEpoch
      ? source
      : -1;
  };
  return { commitRows, sourceRowOf, writePageRow };
}
