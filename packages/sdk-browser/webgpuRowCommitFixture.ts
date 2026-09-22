// Setup of the two row tests: the catalogue, the row writer, an image and the full state compared.
// Posted separately because two tests use it — the differential comparison against the oracle from
// before lot F (`webgpuRowCommit.test.ts`) and the direct proof of row recycling
// (`webgpuRowRecycle.test.ts`), which nothing differential can prove since the oracle carries the
// same guard word for word.
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
export function mount(
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
  /** CPU cut of the image: it is the one, and the only one, that reaches `commitRows`. */
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

export type Mount = ReturnType<typeof mount>;
export type Plan = { offsets: Int32Array; coupeProcesseur: boolean; descendante?: boolean };

export /**
 * One image. The residency mirror posts the offsets and names, like it, every page it moves; then
 * only one of the two rank paths runs, as in the engine: the GPU cut lets rank sync follow residency,
 * the CPU cut names its own ranks. The latter is the only one that reaches `commitRows`, therefore
 * the only one where F4 shows.
 */
function image(mounted: Mount, plan: Plan) {
  const { rows, pages, coupe } = mounted;
  for (let page = 0; page < plan.offsets.length; page++) {
    if (rows.residentOffsetWords[page] === plan.offsets[page]) continue;
    rows.residentOffsetWords[page] = plan.offsets[page];
    rows.touchPage(page);
  }
  if (!plan.coupeProcesseur) {
    rows.rowsEpoch = -1;
    mounted.sync.syncRows();
    return;
  }
  coupe.length = 0;
  for (let page = 0; page < pages.length; page++)
    if (rows.residentOffsetWords[page] >= 0 && pages[page].array) coupe.push(pages[page]);
  if (plan.descendante) coupe.reverse();
  mounted.sync.syncRowsFromCut();
}
export function etatComplet(rows: ReturnType<typeof createWebgpuRowState>) {
  return {
    table: new Uint32Array((rows.pageTableInts as Uint32Array).buffer.slice(0)),
    rowPageIndex: rows.rowPageIndex.slice(),
    rowOffsetWords: rows.rowOffsetWords.slice(),
    rowEpoch: rows.rowEpoch.slice(),
    rowOfPage: rows.rowOfPage.slice(),
    residentFlags: rows.residentFlags.slice(),
    // Residency journal of the pass: what shadow cull and the GPU cut reread.
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

/** Offsets of an image, one per page. */
export const offsetsPar = (rempli: (page: number) => number) =>
  Int32Array.from({ length: PAGES }, (_, page) => rempli(page));
