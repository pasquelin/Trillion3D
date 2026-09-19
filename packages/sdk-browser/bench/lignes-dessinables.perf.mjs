// the drawable-row table.
import { createWebgpuRowState } from '../webgpuRowState.ts';
import { createWebgpuRowCommit } from '../webgpuRowCommit.ts';
import { createWebgpuRowSync } from '../webgpuRowSync.ts';
import { PAGE_INFO_STRIDE } from '../visibilityTypes.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import { referenceRowCommit, referenceRowState } from './oracles/lignes-dessinables.mjs';

const MOTS = PAGE_INFO_STRIDE / 4;
const alea = graine(509);
const PAGES = 12000,
  SLOTS = 8192;

const catalogue = () => {
  const pages = [];
  for (let i = 0; i < PAGES; i++)
    pages.push({
      id: i,
      url: `p/${i}`,
      triangles: 3,
      array: i % 7 ? new Uint32Array(3) : undefined,
      transparent: i % 11 === 0,
      depthLayer: 0,
    });
  return pages;
};

const ecrivain = (rec, pageIndex, row, offsetWords, index, floats, ints) => {
  const base = row * MOTS;
  floats.fill(0, base, base + MOTS);
  floats[base] = pageIndex;
  floats[base + 1] = offsetWords;
  floats[base + 2] = index.length;
  ints[base + 3] = row + 1;
  ints[base + 4] = rec.id;
};

const images = [];
for (let image = 0; image < 8; image++) {
  const offsets = new Int32Array(PAGES).fill(-1);
  for (let i = 0; i < PAGES; i++)
    if ((i + image * 37) % 5) offsets[i] = ((i * 13 + image * 101) % 65536) * 4;
  images.push(offsets);
}

const pagesCommunes = catalogue();

const mount = (fabriqueCommit) => {
  const pages = pagesCommunes;
  const rows = createWebgpuRowState(pages, SLOTS);
  const tampon = new ArrayBuffer(SLOTS * PAGE_INFO_STRIDE);
  rows.pageTableFloats = new Float32Array(tampon);
  rows.pageTableInts = new Uint32Array(tampon);
  for (let i = 0; i < PAGES; i++) rows.pagePositions[i] = i % 23 ? { slot: i } : undefined;
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

const etatComplet = (rows) => ({
  table: new Uint32Array(rows.pageTableInts.buffer.slice(0)),
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

const passe = (fabriqueCommit) => (input) => {
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
  fichier: 'packages/sdk-browser/webgpuRowCommit.ts',
  cas,
  calcul: passe(createWebgpuRowCommit),
  attendu: passe(referenceRowCommit),
  options: { tours: 30, budgetMs: 1500 },
});

// The rank of a page, asked for every cluster of a frame's CPU cut.
const pagesF5 = catalogue();
const etatF5 = createWebgpuRowState(pagesF5, SLOTS);
const referenceF5 = referenceRowState(pagesF5, SLOTS);
const etrangeres = [];
for (let i = 0; i < 2000; i++) etrangeres.push({ id: i, url: `x/${i}`, packedIndex: i });
const demandes = [];
for (let i = 0; i < 20000; i++) {
  const r = alea();
  demandes.push(
    r < 0.9 ? pagesF5[Math.floor(alea() * PAGES)] : etrangeres[Math.floor(alea() * 2000)],
  );
}
const rangs = (etat) => (liste) => {
  const output = new Array(liste.length);
  for (let i = 0; i < liste.length; i++) output[i] = etat.pageIndexOf(liste[i]) ?? -1;
  return output;
};

const resRangs = await mesure({
  name: 'rank of a catalogue page',
  fichier: 'packages/sdk-browser/webgpuRowState.ts',
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
  calcul: (p) => createWebgpuRowState(p, 10),
  extremes: [{ name: 'empty', input: [] }],
});

rapport(
  'lignes-dessinables',
  [resLignes, resRangs],
  'F4 and F5 yield the exact same row table and ranks',
);
