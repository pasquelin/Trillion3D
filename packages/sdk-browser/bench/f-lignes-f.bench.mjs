// F4 et F5 : la table des lignes dessinables. F4 ne réécrit la page, l'offset, l'époque et le rang
// inverse que des lignes déplacées ou reconstruites — une ligne restée en place les portait déjà.
// F5 fait voyager le rang d'une page sur la page elle-même, au lieu d'une table de hachage relue par
// cluster et par image. La comparaison porte sur l'état complet des tableaux après une suite de
// deltas de résidence, pas sur une seule image.
import { createWebgpuRowState } from '../webgpuRowState.ts';
import { createWebgpuRowCommit } from '../webgpuRowCommit.ts';
import { createWebgpuRowSync } from '../webgpuRowSync.ts';
import { PAGE_INFO_STRIDE } from '../visibilityTypes.ts';
import { compare, graine } from '../../sdk-core/bench/banc.mjs';
import { verifieEtDeposeF } from '../../sdk-core/bench/bancF.mjs';
import { referenceRowCommit, referenceRowState } from './oracles/f-lignes.mjs';

const MOTS = PAGE_INFO_STRIDE / 4;
const alea = graine(509);
const PAGES = 12000,
  SLOTS = 8192;

/** Un catalogue de pages : une sur onze transparente, une sur sept sans octets d'index. */
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

/** Un écrivain de ligne déterministe : la ligne porte sa page, son offset et son rang. */
const ecrivain = (rec, pageIndex, row, offsetWords, index, floats, ints) => {
  const base = row * MOTS;
  floats.fill(0, base, base + MOTS);
  floats[base] = pageIndex;
  floats[base + 1] = offsetWords;
  floats[base + 2] = index.length;
  ints[base + 3] = row + 1;
  ints[base + 4] = rec.id;
};

/** Huit images : la résidence bascule, des pages entrent, d'autres sortent, la coupe se décale. */
const images = [];
for (let image = 0; image < 8; image++) {
  const offsets = new Int32Array(PAGES).fill(-1);
  for (let i = 0; i < PAGES; i++)
    if ((i + image * 37) % 5) offsets[i] = ((i * 13 + image * 101) % 65536) * 4;
  images.push(offsets);
}

/** Le catalogue est monté une fois : la ligne mesure la validation de la table, pas sa fabrication. */
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

/** L'état complet que les deux côtés doivent rendre identique, tableaux compris. */
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

const vide = [new Int32Array(PAGES).fill(-1)];
const cas = [
  { nom: '8 images, 12 000 pages', entree: { images, epoques: false }, taille: PAGES * 8 },
  {
    nom: '8 images, époque de table relancée',
    entree: { images, epoques: true },
    taille: PAGES * 8,
  },
  { nom: 'résidence vide', entree: { images: vide, epoques: false }, taille: 0 },
  { nom: 'une seule image', entree: { images: [images[0]], epoques: false }, taille: PAGES },
];

const lignes = [
  await compare({
    calcul: 'F4 table des lignes, écriture de queue',
    fichier: 'packages/sdk-browser/webgpuRowCommit.ts',
    cas,
    reference: passe(referenceRowCommit),
    optimisee: passe(createWebgpuRowCommit),
    options: { chauffe: 5, tours: 200, budgetMs: 4000 },
  }),
];

/** F5 seul : le rang d'une page, demandé pour chaque cluster de la coupe CPU d'une image. */
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
  const sortie = new Array(liste.length);
  for (let i = 0; i < liste.length; i++) sortie[i] = etat.pageIndexOf(liste[i]) ?? -1;
  return sortie;
};

lignes.push(
  await compare({
    calcul: 'F5 rang d’une page du catalogue',
    fichier: 'packages/sdk-browser/webgpuRowState.ts',
    cas: [
      { nom: '20 000 demandes, 10 % hors catalogue', entree: demandes, taille: demandes.length },
      { nom: 'une seule page', entree: [pagesF5[0]], taille: 1 },
      { nom: 'page étrangère au rang usurpé', entree: [etrangeres[0]], taille: 1 },
      { nom: 'aucune demande', entree: [], taille: 0 },
    ],
    reference: rangs(referenceF5),
    optimisee: rangs(etatF5),
    options: { tours: 200, budgetMs: 2500 },
  }),
);

verifieEtDeposeF(
  'f-lignes',
  'F4 et F5 rendent exactement la même table de lignes et les mêmes rangs',
  lignes,
);
