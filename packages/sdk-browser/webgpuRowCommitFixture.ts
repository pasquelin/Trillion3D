// Le montage des deux tests de lignes : le catalogue, l'écrivain de ligne, une image et l'état
// complet qu'on compare. Posé à part parce que deux tests l'emploient — la comparaison
// différentielle contre l'oracle d'avant le lot F (`webgpuRowCommit.test.ts`) et la preuve directe
// du recyclage de ligne (`webgpuRowRecycle.test.ts`), que rien de différentiel ne peut prouver
// puisque l'oracle porte la même garde au mot près.
import { createWebgpuRowState } from './webgpuRowState.ts';
import { createWebgpuRowCommit } from './webgpuRowCommit.ts';
import { createWebgpuRowSync } from './webgpuRowSync.ts';
import { PAGE_INFO_STRIDE } from './visibilityTypes.ts';
import type { PageRec } from './pageSelection.ts';

const MOTS = PAGE_INFO_STRIDE / 4;
export const PAGES = 6,
  SLOTS = 4;

export function catalogue(): PageRec[] {
  const pages = [];
  for (let i = 0; i < PAGES; i++)
    pages.push({
      id: i,
      url: `p/${i}`,
      array: i === 2 ? undefined : Uint32Array.of(0, 1, 2),
      transparent: i === 4,
      depthLayer: 0,
    } as unknown as PageRec);
  return pages;
}
const ecrivain = (
  rec: PageRec,
  pageIndex: number,
  row: number,
  offsetWords: number,
  _index: Uint32Array,
  floats: Float32Array,
  ints: Uint32Array,
) => {
  const base = row * MOTS;
  floats.fill(0, base, base + MOTS);
  floats[base] = pageIndex;
  floats[base + 1] = offsetWords;
  ints[base + 3] = row + 1;
  ints[base + 4] = rec.id as number;
};
export function monte(
  fabriqueEtat: typeof createWebgpuRowState = createWebgpuRowState,
  fabriqueCommit: typeof createWebgpuRowCommit = createWebgpuRowCommit,
) {
  const pages = catalogue();
  const rows = fabriqueEtat(pages, SLOTS);
  const tampon = new ArrayBuffer(SLOTS * PAGE_INFO_STRIDE);
  rows.pageTableFloats = new Float32Array(tampon);
  rows.pageTableInts = new Uint32Array(tampon);
  for (let i = 0; i < PAGES; i++) rows.pagePositions[i] = { slot: i } as unknown as GPUBuffer;
  const commit = fabriqueCommit(rows, ecrivain);
  /** La coupe processeur de l'image : c'est elle, et elle seule, qui atteint `commitRows`. */
  const coupe: PageRec[] = [];
  const sync = createWebgpuRowSync(
    rows,
    { sync: () => {}, dirty: true },
    pages,
    coupe,
    SLOTS,
    () => true,
    commit,
  );
  return { rows, sync, pages, coupe, commit };
}

export type Monte = ReturnType<typeof monte>;
export type Plan = { offsets: Int32Array; coupeProcesseur: boolean; descendante?: boolean };

export /**
 * Une image. Le miroir de résidence pose les offsets et nomme, comme lui, chaque page qu'il déplace ;
 * puis un seul des deux chemins de rangs passe, comme dans le moteur : la coupe GPU laisse la
 * synchronisation des rangs suivre la résidence, la coupe processeur nomme ses propres rangs. Ce
 * dernier est le seul à atteindre `commitRows`, donc le seul où F4 se voit.
 */
function image(monté: Monte, plan: Plan) {
  const { rows, pages, coupe } = monté;
  for (let page = 0; page < plan.offsets.length; page++) {
    if (rows.residentOffsetWords[page] === plan.offsets[page]) continue;
    rows.residentOffsetWords[page] = plan.offsets[page];
    rows.touchPage(page);
  }
  if (!plan.coupeProcesseur) {
    rows.rowsEpoch = -1;
    monté.sync.syncRows();
    return;
  }
  coupe.length = 0;
  for (let page = 0; page < pages.length; page++)
    if (rows.residentOffsetWords[page] >= 0 && pages[page].array) coupe.push(pages[page]);
  if (plan.descendante) coupe.reverse();
  monté.sync.syncRowsFromCut();
}
export function etatComplet(rows: ReturnType<typeof createWebgpuRowState>) {
  return {
    table: new Uint32Array((rows.pageTableInts as Uint32Array).buffer.slice(0)),
    rowPageIndex: rows.rowPageIndex.slice(),
    rowOffsetWords: rows.rowOffsetWords.slice(),
    rowEpoch: rows.rowEpoch.slice(),
    rowOfPage: rows.rowOfPage.slice(),
    residentFlags: rows.residentFlags.slice(),
    // Le journal des résidences de la passe : ce que le rejet d'ombres et la coupe GPU relisent.
    residencyChanges: {
      pages: rows.residencyChanges.pages.slice(0, rows.residencyChanges.count),
      sorted: rows.residencyChanges.sorted,
    },
    rowCount: rows.rowCount,
    packedCount: rows.packedCount,
    candidateCount: rows.candidateCount,
    candidateOverflow: rows.candidateOverflow,
    rowsChanged: rows.rowsChanged,
  };
}

/** Les offsets d'une image, un par page. */
export const offsetsPar = (rempli: (page: number) => number) =>
  Int32Array.from({ length: PAGES }, (_, page) => rempli(page));
