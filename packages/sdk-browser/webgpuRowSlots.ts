import { sortPages } from '../sdk-core/index.ts';
import { createWebgpuRowWriters } from './webgpuRowWriters.ts';
import { createWebgpuRowClaims, serveClaims } from './webgpuRowClaims.ts';
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
 * cache a nommé suffit, et la liste des pages nommées ne déborde plus. Les rangs restent contigus,
 * parce que tout ce qui lit la table lit `[0, packedCount)` sans jamais sauter une ligne vide ; les
 * rangs qu'une passe libère sans que personne ne les reprenne sont comblés par la fin de la table,
 * d'un déplacement chacun.
 *
 * Le rang d'une page ne change donc que si une autre page part devant elle, et le numéro lui-même
 * n'a de sens que pour l'image en cours : la fiche, les coins, la sphère d'ombre et le verdict
 * d'occultation d'une ligne sont réécrits avec elle dès qu'elle bouge.
 *
 * Écrire une fiche est ce que l'image paie vraiment, et une rafale d'arrivées en réclame autant
 * d'un coup : elles passent par une file bornée par un budget de TEMPS. Une page dont la fiche
 * n'est pas encore écrite n'est pas résidente — son drapeau ne se lève qu'après —, donc la coupe ne
 * la choisit pas et son parent résident la couvre : aucun trou, seulement une page en retard.
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
  /** Les pages qui réclament une fiche et attendent leur tour, d'une image à l'autre. */
  const claims = createWebgpuRowClaims(packedPages.length);
  const {
    assign,
    moveRow,
    state: written,
  } = createWebgpuRowWriters(rows, packedPages, writePageRow);
  let count = 0,
    candidates = 0,
    denied = 0,
    epoch = -1,
    revision = -1;

  /** Vrai quand le rang d'une page porte bien son emplacement courant dans le cache. */
  const rowWritten = (page: number) => {
    const row = rows.rowOfPage[page];
    return (
      row >= 0 &&
      rows.rowOffsetWords[row] === rows.residentOffsetWords[page] &&
      rows.rowEpoch[row] === rows.tableEpoch
    );
  };

  /**
   * Le drapeau de résidence d'une page, et le compte des candidats qui le suit. Idempotente : une
   * page nommée deux fois par la même passe ne change rien la seconde fois.
   *
   * Un cluster transparent est résident, demandé et budgété comme les autres, mais il ne réclame pas
   * de ligne du tampon de visibilité : il se dessine dans la passe de mélange, donc ne compte pas.
   */
  const setResident = (page: number, resident: boolean) => {
    const value = resident ? 1 : 0;
    if (rows.residentFlags[page] === value) return;
    const rec = packedPages[page];
    rows.residentFlags[page] = value;
    rows.noteResidencyChange(page);
    onResidenceChange(rec);
    if (!rec.transparent) candidates += resident ? 1 : -1;
  };

  /**
   * Relit ce que le cache vient de faire d'une page et lui reprend le rang qu'elle ne mérite plus.
   * Rend `true` quand la page réclame l'écriture d'une fiche — elle est résidente, dessinable, et
   * son rang ne décrit pas encore son emplacement.
   */
  const release = (page: number) => {
    const rec = packedPages[page],
      offsetWords = rows.residentOffsetWords[page];
    const resident = offsetWords >= 0 && !!rec.array;
    const wantsRow = resident && !rec.transparent && !!rows.pagePositions[page];
    setResident(page, resident && (!wantsRow || rowWritten(page)));
    if (wantsRow) return !rows.residentFlags[page];
    const row = rows.rowOfPage[page];
    if (row < 0) return false;
    rows.rowOfPage[page] = -1;
    free.rows[free.count++] = row;
    written.changed = true;
    return false;
  };

  /**
   * Écrit la fiche d'une page : à son rang s'il est encore le sien, sinon à un rang rendu ou à la
   * fin de la table. Le drapeau de résidence ne se lève qu'ensuite. Rend `false` quand la table est
   * pleine — c'est alors un débordement, et rien n'ira plus loin cette image.
   */
  const place = (page: number) => {
    const offsetWords = rows.residentOffsetWords[page],
      row = rows.rowOfPage[page];
    if (row >= 0) assign(row, page, offsetWords);
    else if (free.count) assign(free.rows[--free.count], page, offsetWords);
    else if (count < drawSlots) assign(count++, page, offsetWords);
    else return false;
    setResident(page, true);
    return true;
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
   * Toute la table refaite depuis le catalogue : l'ordre des rangs y est celui des pages. Le seul
   * motif qui reste est un âge de table nouveau, ou une table réécrite par un autre chemin — jamais
   * une liste de pages nommées trop longue, qui n'existe plus.
   */
  const rebuild = () => {
    rows.rowOfPage.fill(-1);
    count = 0;
    free.count = 0;
    written.changed = true;
    claims.clear();
    for (let page = 0; page < packedPages.length; page++)
      if (release(page) && !place(page)) denied++;
  };

  /** Ce que l'image doit à la table de lignes : les pages que le cache a nommées, et ce que la file
   *  des fiches a laissé derrière elle, dans la limite du budget de temps. */
  const apply = () => {
    written.changed = false;
    denied = 0;
    const full = revision !== rows.rowsRevision || epoch !== rows.tableEpoch;
    if (full) rebuild();
    else {
      // Les départs d'abord, les arrivées ensuite : un rang rendu par une page nommée tard doit
      // pouvoir servir à une page nommée tôt. Les deux passes gardent l'ordre croissant que le
      // journal des résidences exige.
      sortPages(rows.touched.pages, rows.touched.count);
      for (let i = 0; i < rows.touched.count; i++) {
        const page = rows.touched.pages[i];
        if (release(page)) claims.add(page);
      }
      denied = serveClaims(claims, release, place);
      closeFreeRows();
    }
    rows.clearTouched();
    epoch = rows.tableEpoch;
    revision = ++rows.rowsRevision;
    if (written.changed || rows.packedCount !== count) rows.rowsChanged = true;
    rows.rowCount = count;
    rows.packedCount = count;
    rows.candidateCount = candidates;
    rows.candidateOverflow = denied;
  };
  return {
    apply,
    /** Fiches encore dues : l'image suivante doit repasser même si le cache n'a rien bougé. */
    get pending() {
      return claims.count;
    },
  };
}
