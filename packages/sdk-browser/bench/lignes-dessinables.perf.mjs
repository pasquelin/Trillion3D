// F4 et F5 : la table des lignes dessinables.
import { createWebgpuRowState } from '../webgpuRowState.ts';
import { createWebgpuRowCommit } from '../webgpuRowCommit.ts';
import { createWebgpuRowSync } from '../webgpuRowSync.ts';
import { PAGE_INFO_STRIDE } from '../visibilityTypes.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
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

const monte = (fabriqueCommit) => {
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

const passe = (fabriqueCommit) => (entree) => {
  const { rows, sync } = monte(fabriqueCommit);
  for (let tour = 0; tour < entree.images.length; tour++) {
    rows.residentOffsetWords.set(entree.images[tour]);
    rows.tableEpoch += entree.epoques ? 1 : 0;
    rows.rowsEpoch = -1;
    sync.syncRows();
  }
  return etatComplet(rows);
};

const cas = [
  { nom: '8 images, 12 000 pages', entree: { images, epoques: false }, taille: PAGES * 8 },
  { nom: 'époques qui avancent', entree: { images, epoques: true }, taille: PAGES * 8 },
];

const resLignes = await mesure({
  nom: 'F4 table des lignes dessinables',
  fichier: 'packages/sdk-browser/webgpuRowCommit.ts',
  cas,
  calcul: passe(createWebgpuRowCommit),
  attendu: passe(referenceRowCommit),
  options: { tours: 30, budgetMs: 1500 },
});

await stress({
  nom: 'createWebgpuRowState extremes',
  calcul: (p) => createWebgpuRowState(p, 10),
  extremes: [{ nom: 'vide', entree: [] }],
});

rapport('f-lignes', [resLignes], 'F4 et F5 tiennent exactement les mêmes tables de lignes');
