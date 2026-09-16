import { createWebgpuRowJournal } from './webgpuRowJournal.ts';
import type { PageRec } from './pageSelection.ts';

/** Stable row and residency arrays shared by the cut, visibility pass, and cache journal. */
export function createWebgpuRowState(packedPages: PageRec[], drawSlots: number) {
  const residentFlags = new Uint32Array(packedPages.length);
  const pageIndicesByUrl = new Map<string, number[]>();
  for (let i = 0; i < packedPages.length; i++) {
    const page = packedPages[i];
    const indices = pageIndicesByUrl.get(page.url);
    if (indices) indices.push(i);
    else pageIndicesByUrl.set(page.url, [i]);
    page.packedIndex = i;
  }
  /**
   * Le rang d'une page du catalogue, ou `undefined` : le rang voyage sur la page elle-même plutôt que
   * dans une table de hachage relue par cluster et par image. Le catalogue a le dernier mot — un rang
   * posé par un autre moteur ne survit pas à la vérification, exactement comme une page absente de la
   * table ne rendait rien.
   */
  const pageIndexOf = (rec: PageRec) => {
    const index = rec.packedIndex;
    return index !== undefined && packedPages[index] === rec ? index : undefined;
  };

  /** Les pages nommées par le cache et celles dont le drapeau de résidence vient de basculer. */
  const journal = createWebgpuRowJournal(packedPages.length);
  const residentOffsetWords = new Int32Array(packedPages.length).fill(-1);
  const rowPageIndex = new Int32Array(drawSlots).fill(-1);
  const rowOffsetWords = new Int32Array(drawSlots).fill(-1);
  const rowEpoch = new Int32Array(drawSlots);
  const packedPageIndex = new Int32Array(drawSlots);
  const newRowPage = new Int32Array(drawSlots);
  const newRowSource = new Int32Array(drawSlots);
  const rowOfPage = new Int32Array(packedPages.length).fill(-1);
  const rowRewrites = new Int32Array(drawSlots);
  const packedRecs: Array<PageRec | undefined> = new Array(drawSlots).fill(undefined);
  const packedPositions: Array<GPUBuffer | undefined> = new Array(drawSlots).fill(undefined);
  const pagePositions: Array<GPUBuffer | undefined> = new Array(packedPages.length).fill(undefined);
  let rowCount = 0,
    tableEpoch = 1,
    rowsEpoch = 0;
  let dirtyFrom = drawSlots,
    dirtyTo = -1;
  let candidateCount = 0,
    candidateOverflow = 0;
  /**
   * L'âge de la table de lignes elle-même. Toute écriture des rangs par un autre chemin que
   * l'allocateur incrémental l'avance, et celui-ci reconstruit alors plutôt que de croire à une
   * correspondance page → rang qu'il n'a pas posée.
   */
  let rowsRevision = 0;
  let packedCount = 0,
    rowsChanged = true;
  let pageTableFloats: Float32Array | undefined, pageTableInts: Uint32Array | undefined;
  const markRowDirty = (row: number) => {
    if (row < dirtyFrom) dirtyFrom = row;
    if (row > dirtyTo) dirtyTo = row;
  };

  return {
    ...journal,
    residentFlags,
    pageIndicesByUrl,
    pageIndexOf,
    residentOffsetWords,
    rowPageIndex,
    rowOffsetWords,
    rowEpoch,
    packedPageIndex,
    newRowPage,
    newRowSource,
    rowOfPage,
    rowRewrites,
    packedRecs,
    packedPositions,
    pagePositions,
    markRowDirty,
    get rowCount() {
      return rowCount;
    },
    set rowCount(value: number) {
      rowCount = value;
    },
    get tableEpoch() {
      return tableEpoch;
    },
    set tableEpoch(value: number) {
      tableEpoch = value;
    },
    get rowsEpoch() {
      return rowsEpoch;
    },
    set rowsEpoch(value: number) {
      rowsEpoch = value;
    },
    get dirtyFrom() {
      return dirtyFrom;
    },
    set dirtyFrom(value: number) {
      dirtyFrom = value;
    },
    get dirtyTo() {
      return dirtyTo;
    },
    set dirtyTo(value: number) {
      dirtyTo = value;
    },
    get candidateCount() {
      return candidateCount;
    },
    set candidateCount(value: number) {
      candidateCount = value;
    },
    get rowsRevision() {
      return rowsRevision;
    },
    set rowsRevision(value: number) {
      rowsRevision = value;
    },
    get candidateOverflow() {
      return candidateOverflow;
    },
    set candidateOverflow(value: number) {
      candidateOverflow = value;
    },
    get packedCount() {
      return packedCount;
    },
    set packedCount(value: number) {
      packedCount = value;
    },
    get rowsChanged() {
      return rowsChanged;
    },
    set rowsChanged(value: boolean) {
      rowsChanged = value;
    },
    get pageTableFloats() {
      return pageTableFloats;
    },
    set pageTableFloats(value: Float32Array | undefined) {
      pageTableFloats = value;
    },
    get pageTableInts() {
      return pageTableInts;
    },
    set pageTableInts(value: Uint32Array | undefined) {
      pageTableInts = value;
    },
  };
}

/** Ce que `dirtyRange` vient de calculer, rendu tel quel : le tampon est relu sur-le-champ par son
 *  appelant, avant tout autre appel, et aucune image n'alloue donc pour porter deux entiers. */
const dirty = { from: 0, to: -1 };

/**
 * La plage de lignes qu'un témoin doit réécrire : celle que la table déclare sale, bornée au rang
 * dessinable. Un témoin périmé — l'âge de la table a changé, ou ce qu'il décrivait n'existe plus —
 * redemande toute la table ; sinon un rang qui a grandi élargit la plage jusqu'aux lignes qui
 * viennent d'y entrer. `held` est le nombre de lignes que le témoin tenait, jamais négatif.
 */
export function dirtyRange(
  rows: { dirtyFrom: number; dirtyTo: number; packedCount: number },
  stale: boolean,
  held: number,
) {
  const last = rows.packedCount - 1;
  let from = rows.dirtyFrom,
    to = Math.min(rows.dirtyTo, last);
  if (stale) {
    from = 0;
    to = last;
  } else if (rows.packedCount > held) {
    from = Math.min(from, held);
    to = last;
  }
  dirty.from = from;
  dirty.to = to;
  return dirty;
}
