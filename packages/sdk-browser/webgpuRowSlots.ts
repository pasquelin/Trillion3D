import { sortPages } from './webgpuRowJournal.ts';
import { createWebgpuRowWriters } from './webgpuRowWriters.ts';
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
  /** Les rangs rendus par cette passe-ci, en attente d'un repreneur ou d'un comblement. */
  const free = { rows: new Int32Array(Math.max(1, drawSlots)), count: 0 };
  const {
    assign,
    moveRow,
    state: written,
  } = createWebgpuRowWriters(rows, packedPages, writePageRow);
  let count = 0,
    candidates = 0,
    positioned = 0,
    epoch = -1,
    revision = -1;

  /**
   * Met le drapeau de résidence d'une page à jour et lui reprend le rang qu'elle ne mérite plus.
   * Rend `true` quand la page réclame un rang. Idempotente — une page nommée deux fois par la même
   * passe ne change rien la seconde fois.
   *
   * Un cluster transparent est résident, demandé et budgété comme les autres, mais il ne réclame pas
   * de ligne du tampon de visibilité : il se dessine dans la passe de mélange.
   */
  const release = (page: number) => {
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
    if (resident && !rec.transparent && position) return true;
    const row = rows.rowOfPage[page];
    if (row < 0) return false;
    rows.rowOfPage[page] = -1;
    free.rows[free.count++] = row;
    written.changed = true;
    return false;
  };

  /** Pose une page qui réclame un rang : le sien s'il est encore exact, sinon un rang rendu ou la fin. */
  const place = (page: number) => {
    const offsetWords = rows.residentOffsetWords[page],
      row = rows.rowOfPage[page];
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

  /**
   * Toute la table refaite depuis le catalogue : l'ordre des rangs y est celui des pages. Les deux
   * comptes sont recomptés plutôt que suivis, puisque le catalogue est de toute façon parcouru.
   */
  const rebuild = () => {
    rows.rowOfPage.fill(-1);
    count = 0;
    free.count = 0;
    written.changed = true;
    let placeable = 0,
      wanted = 0;
    for (let page = 0; page < packedPages.length; page++) {
      if (release(page)) place(page);
      if (!rows.residentFlags[page] || packedPages[page].transparent) continue;
      placeable++;
      if (rows.pagePositions[page]) wanted++;
    }
    candidates = placeable;
    positioned = wanted;
  };

  /**
   * Ce que l'image doit à la table de lignes. Le coût est celui des pages que le cache a nommées,
   * sauf reconstruction : table réécrite par un autre chemin, âge de table nouveau, liste débordée,
   * ou plus de candidats placés que de rangs — c'est alors l'ordre du catalogue qui dit lesquels
   * débordent, exactement comme avant.
   */
  const apply = () => {
    written.changed = false;
    const full =
      revision !== rows.rowsRevision || epoch !== rows.tableEpoch || rows.touched.overflow;
    if (full) rebuild();
    else {
      sortPages(rows.touched.pages, rows.touched.count);
      // Les départs d'abord, les arrivées ensuite : un rang rendu par une page nommée tard doit
      // pouvoir servir à une page nommée tôt, sinon une arrivée déborde devant une table qui va se
      // vider. Les deux passes gardent l'ordre croissant que le journal des résidences exige.
      let wanted = 0;
      for (let i = 0; i < rows.touched.count; i++) {
        const page = rows.touched.pages[i];
        if (release(page)) rows.touched.pages[wanted++] = page;
      }
      for (let i = 0; i < wanted; i++) place(rows.touched.pages[i]);
      closeFreeRows();
    }
    rows.clearTouched();
    // Plus de pages à placer que de rangs tenus : un débordement passé a laissé une page sans rang
    // alors que la table a de la place. Le catalogue tranche, exactement comme avant.
    if (!full && positioned > count) rebuild();
    epoch = rows.tableEpoch;
    revision = ++rows.rowsRevision;
    if (written.changed || rows.packedCount !== count) rows.rowsChanged = true;
    rows.rowCount = count;
    rows.packedCount = count;
    rows.candidateCount = candidates;
    rows.candidateOverflow =
      Math.max(0, positioned - drawSlots) + Math.max(0, candidates - drawSlots);
  };
  return { apply };
}
