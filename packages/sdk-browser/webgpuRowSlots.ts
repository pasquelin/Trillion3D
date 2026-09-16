import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import { ROW_ID_BASE_WORD, ROW_HIZ_SLOT_WORD, packedRowBase } from './webgpuPageRow.ts';
import { sortPages } from '../sdk-core/index.ts';
import type { PageRec } from './pageSelection.ts';
import type { createPageRowWriter } from './webgpuPageRow.ts';
import type { createWebgpuRowState } from './webgpuRowState.ts';

type Rows = ReturnType<typeof createWebgpuRowState>;
type Writer = ReturnType<typeof createPageRowWriter>;

/**
 * Les rangs de la table de lignes, tenus page par page.
 *
 * Une page qui entre prend un rang — celui qu'une page sortie vient de libérer, sinon la fin de la
 * table — et une page qui sort rend le sien. Aucune image ne reparcourt le catalogue : ce que le
 * cache a nommé suffit. Les rangs restent contigus, parce que tout ce qui lit la table lit
 * `[0, packedCount)` sans jamais sauter une ligne vide ; les rangs qu'une passe libère sans que
 * personne ne les reprenne sont comblés par la fin de la table, d'un déplacement chacun.
 *
 * Le rang d'une page ne change donc que si une autre page part devant elle, et le numéro lui-même
 * n'a de sens que pour l'image en cours : la fiche, les coins, la sphère d'ombre et le verdict
 * d'occultation d'une ligne sont réécrits avec elle dès qu'elle bouge.
 */
export function createWebgpuRowSlots(
  rows: Rows,
  packedPages: PageRec[],
  drawSlots: number,
  writePageRow: Writer,
  onResidenceChange: (rec: PageRec) => void,
) {
  const rowWords = PAGE_INFO_STRIDE / 4;
  /** Les rangs rendus par cette passe-ci, en attente d'un repreneur ou d'un comblement. */
  const free = { rows: new Int32Array(Math.max(1, drawSlots)), count: 0 };
  let count = 0,
    candidates = 0,
    positioned = 0,
    epoch = -1,
    revision = -1,
    changed = false;

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
    changed = true;
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
    changed = true;
  };

  /**
   * Met une page d'accord avec sa résidence : le drapeau, le journal, puis le rang. Idempotente —
   * une page nommée deux fois par la même passe ne change rien la seconde fois.
   */
  const update = (page: number) => {
    const rec = packedPages[page],
      offsetWords = rows.residentOffsetWords[page];
    const position = rows.pagePositions[page];
    const resident = offsetWords >= 0 && !!rec.array ? 1 : 0;
    if (rows.residentFlags[page] !== resident) {
      rows.residentFlags[page] = resident;
      rows.noteResidencyChange(page);
      onResidenceChange(rec);
      if (!rec.transparent) {
        const step = resident ? 1 : -1;
        candidates += step;
        if (position) positioned += step;
      }
    }
    const row = rows.rowOfPage[page];
    // Un cluster transparent est résident, demandé et budgété comme les autres, mais il ne réclame
    // pas de ligne du tampon de visibilité : il se dessine dans la passe de mélange.
    if (!resident || rec.transparent || !position) {
      if (row < 0) return;
      rows.rowOfPage[page] = -1;
      free.rows[free.count++] = row;
      changed = true;
      return;
    }
    if (row >= 0) {
      if (rows.rowOffsetWords[row] === offsetWords && rows.rowEpoch[row] === rows.tableEpoch)
        return;
      assign(row, page, offsetWords);
      return;
    }
    if (free.count) assign(free.rows[--free.count], page, offsetWords);
    else if (count < drawSlots) assign(count++, page, offsetWords);
  };

  /**
   * La fin de la table comble les rangs qu'aucune page n'a repris. Les trous sont parcourus du plus
   * bas au plus haut et les sources du plus haut au plus bas, en sautant les rangs eux-mêmes libres :
   * chaque ligne survivante est donc déplacée au plus une fois.
   */
  const closeFreeRows = () => {
    if (!free.count) return;
    sortPages(free.rows, free.count);
    const kept = count - free.count;
    let source = count - 1,
      high = free.count - 1;
    for (let i = 0; i < free.count; i++) {
      const hole = free.rows[i];
      if (hole >= kept) break;
      while (high >= 0 && free.rows[high] === source) {
        source--;
        high--;
      }
      moveRow(source--, hole);
    }
    count = kept;
    free.count = 0;
  };

  /** Toute la table refaite depuis le catalogue : l'ordre des rangs y est celui des pages. */
  const rebuild = () => {
    rows.rowOfPage.fill(-1);
    count = 0;
    free.count = 0;
    changed = true;
    for (let page = 0; page < packedPages.length; page++) update(page);
  };

  /**
   * Ce que l'image doit à la table de lignes. Le coût est celui des pages que le cache a nommées,
   * sauf reconstruction : table réécrite par un autre chemin, âge de table nouveau, liste débordée,
   * ou plus de candidats placés que de rangs — c'est alors l'ordre du catalogue qui dit lesquels
   * débordent, exactement comme avant.
   */
  const apply = () => {
    changed = false;
    if (revision !== rows.rowsRevision || epoch !== rows.tableEpoch || rows.touched.overflow)
      rebuild();
    else {
      sortPages(rows.touched.pages, rows.touched.count);
      for (let i = 0; i < rows.touched.count; i++) update(rows.touched.pages[i]);
      closeFreeRows();
    }
    rows.clearTouched();
    if (positioned > drawSlots) rebuild();
    epoch = rows.tableEpoch;
    revision = ++rows.rowsRevision;
    if (changed || rows.packedCount !== count) rows.rowsChanged = true;
    rows.rowCount = count;
    rows.packedCount = count;
    rows.candidateCount = candidates;
    rows.candidateOverflow =
      Math.max(0, positioned - drawSlots) + Math.max(0, candidates - drawSlots);
  };
  return { apply };
}
