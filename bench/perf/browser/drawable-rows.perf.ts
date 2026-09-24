// the drawable-row table.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { surfaceOf } from '../../../packages/sdk-browser/src/page/surface.ts';
import { createWebgpuRowState } from '../../../packages/sdk-browser/src/webgpu/row/state.ts';
import { createWebgpuRowCommit } from '../../../packages/sdk-browser/src/webgpu/row/commit.ts';
import { createWebgpuRowSync } from '../../../packages/sdk-browser/src/webgpu/row/sync.ts';
import { PAGE_INFO_STRIDE } from '../../../packages/sdk-browser/src/visibility/types.ts';
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';
import { referenceRowCommit, referenceRowState } from '../../oracles/browser/drawable-rows.ts';

const MOTS = PAGE_INFO_STRIDE / 4;
const alea = graine(509);
const PAGES = 12000,
  SLOTS = 8192;

/** Fields the row table never reads: shared across every fixture record. */
const DUMMY_MATRIX = new G.Matrix4();
const DUMMY_ATTRIBUTES: G.GraphGeometry['attributes'] = {};
const DUMMY_BOUNDS: number[] = [0, 0, 0];

const catalogue = (): PageRec[] => {
  const pages: PageRec[] = [];
  for (let i = 0; i < PAGES; i++)
    pages.push({
      id: i,
      url: `p/${i}`,
      clusterId: `p/${i}`,
      triangles: 3,
      indexBytes: 0,
      min: DUMMY_BOUNDS,
      max: DUMMY_BOUNDS,
      array: i % 7 ? new Uint32Array(3) : undefined,
      transparent: i % 11 === 0,
      depthLayer: 0,
      attributes: DUMMY_ATTRIBUTES,
      material: surfaceOf([]),
      declaration: [],
      matrix: DUMMY_MATRIX,
      renderOrder: 0,
      attached: true,
    });
  return pages;
};

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
  floats[base + 2] = rec.array?.length ?? 0;
  ints[base + 3] = row + 1;
  ints[base + 4] = rec.id;
};

const images: Int32Array[] = [];
for (let image = 0; image < 8; image++) {
  const offsets = new Int32Array(PAGES).fill(-1);
  for (let i = 0; i < PAGES; i++)
    if ((i + image * 37) % 5) offsets[i] = ((i * 13 + image * 101) % 65536) * 4;
  images.push(offsets);
}

const pagesCommunes = catalogue();

type RowCommitFactory = typeof createWebgpuRowCommit | typeof referenceRowCommit;

const mount = (fabriqueCommit: RowCommitFactory) => {
  const pages = pagesCommunes;
  const rows = createWebgpuRowState(pages, SLOTS);
  const tampon = new ArrayBuffer(SLOTS * PAGE_INFO_STRIDE);
  rows.pageTableFloats = new Float32Array(tampon);
  rows.pageTableInts = new Uint32Array(tampon);
  for (let i = 0; i < PAGES; i++) rows.pagePositions[i] = i % 23 ? ({} as GPUBuffer) : undefined;
  const commit = fabriqueCommit(rows, ecrivain);
  const sync = createWebgpuRowSync(
    rows,
    { sync: () => {}, dirty: true },
    pages,
    [],
    SLOTS,
    () => true,
    commit,
  );
  return { rows, pages, sync };
};

const etatComplet = (rows: ReturnType<typeof createWebgpuRowState>) => ({
  // `mount` always binds the table before a pass runs; this reads it back once done.
  table: new Uint32Array((rows.pageTableInts ?? new Uint32Array(0)).buffer.slice(0)),
  rowPageIndex: rows.rowPageIndex.slice(),
  rowOffsetWords: rows.rowOffsetWords.slice(),
  rowEpoch: rows.rowEpoch.slice(),
  rowOfPage: rows.rowOfPage.slice(),
  residentFlags: rows.residentFlags.slice(),
  newRowPage: rows.newRowPage.slice(),
  newRowSource: rows.newRowSource.slice(),
  rowCount: rows.rowCount,
  packedCount: rows.packedCount,
  candidateCount: rows.candidateCount,
  candidateOverflow: rows.candidateOverflow,
  dirtyFrom: rows.dirtyFrom,
  dirtyTo: rows.dirtyTo,
  rowsChanged: rows.rowsChanged,
});

const passe =
  (fabriqueCommit: RowCommitFactory) => (input: { images: Int32Array[]; epoques: boolean }) => {
    const { rows, sync } = mount(fabriqueCommit);
    for (let tour = 0; tour < input.images.length; tour++) {
      rows.residentOffsetWords.set(input.images[tour]);
      rows.tableEpoch += input.epoques ? 1 : 0;
      rows.rowsEpoch = -1;
      sync.syncRows();
    }
    return etatComplet(rows);
  };

const cas = [
  { name: '8 frames, 12 000 pages', input: { images, epoques: false }, size: PAGES * 8 },
  { name: 'advancing epochs', input: { images, epoques: true }, size: PAGES * 8 },
];

const resLignes = await mesure({
  name: 'drawable-row table',
  fichier: 'packages/sdk-browser/src/webgpu/row/commit.ts',
  cas,
  calcul: passe(createWebgpuRowCommit),
  attendu: passe(referenceRowCommit),
  options: { tours: 30, budgetMs: 1500 },
});

// The rank of a page, asked for every cluster of a frame's CPU cut.
const pagesF5 = catalogue();
const etatF5 = createWebgpuRowState(pagesF5, SLOTS);
const referenceF5 = referenceRowState(pagesF5, SLOTS);
const etrangeres = catalogue()
  .slice(0, 2000)
  .map((page, i) => ({ ...page, url: `x/${i}` }));
const demandes: PageRec[] = [];
for (let i = 0; i < 20000; i++) {
  const r = alea();
  demandes.push(
    r < 0.9 ? pagesF5[Math.floor(alea() * PAGES)] : etrangeres[Math.floor(alea() * 2000)],
  );
}
const rangs =
  (etat: { pageIndexOf: (rec: PageRec) => number | undefined }) => (liste: PageRec[]) => {
    const output = new Array<number>(liste.length);
    for (let i = 0; i < liste.length; i++) output[i] = etat.pageIndexOf(liste[i]) ?? -1;
    return output;
  };

const resRangs = await mesure({
  name: 'rank of a catalogue page',
  fichier: 'packages/sdk-browser/src/webgpu/row/state.ts',
  cas: [
    { name: '20 000 requests, 10% outside the catalogue', input: demandes, size: demandes.length },
    { name: 'a single page', input: [pagesF5[0]], size: 1 },
    { name: 'foreign page at a usurped rank', input: [etrangeres[0]], size: 1 },
    { name: 'no requests', input: [], size: 0 },
  ],
  calcul: rangs(etatF5),
  attendu: rangs(referenceF5),
  options: { tours: 60, budgetMs: 1500 },
});

await stress({
  name: 'createWebgpuRowState extremes',
  calcul: (p: PageRec[]) => createWebgpuRowState(p, 10),
  extremes: [{ name: 'empty', input: [] }],
});

rapport(
  'lignes-dessinables',
  [resLignes, resRangs],
  'F4 and F5 yield the exact same row table and ranks',
);
