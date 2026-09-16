// Lot F, F4 et F5 : F4 (webgpuRowCommit.ts) ne réécrit plus la page, l'offset, l'époque et le rang
// inverse d'une ligne que `sourceRowOf` a rendue exacte ; F5 (webgpuRowState.ts) fait voyager le rang
// d'une page du catalogue sur la page elle-même (`packedIndex`) au lieu d'une table de hachage. Les
// oracles sont les implémentations d'avant le lot F, recopiées telles quelles dans
// `oracles/f-lignes.mjs`. La comparaison porte sur l'état complet des tableaux après une suite
// d'images, pas sur une seule image : c'est là que les lignes réutilisées se voient.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuRowState } from './webgpuRowState.ts';
import { createWebgpuRowCommit } from './webgpuRowCommit.ts';
import { createWebgpuRowSync } from './webgpuRowSync.ts';
import { PAGE_INFO_STRIDE } from './visibilityTypes.ts';
import { referenceRowCommit, referenceRowState } from './bench/oracles/f-lignes.mjs';
import type { PageRec } from './pageSelection.ts';

const MOTS = PAGE_INFO_STRIDE / 4;
const PAGES = 6,
  SLOTS = 4;

/** Six pages : une sans octets d'index (jamais résidente), une transparente (jamais dessinable). */
function catalogue(): PageRec[] {
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

function monte(
  fabriqueEtat: typeof createWebgpuRowState,
  fabriqueCommit: typeof createWebgpuRowCommit,
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
  return { rows, sync, pages, coupe };
}

type Monte = ReturnType<typeof monte>;

/**
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

function etatComplet(rows: ReturnType<typeof createWebgpuRowState>) {
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

type Plan = { offsets: Int32Array; coupeProcesseur: boolean; descendante?: boolean };

/**
 * Neuf images hostiles : vide, une seule page, tout résident, une page qui part par le DEVANT — les
 * rangs suivants se décalent alors d'un bloc, ce que F4 déplace au lieu de le réécrire — et son
 * retour, un ordre de coupe inversé qui interdit le déplacement, et une époque de table relancée.
 */
function images(): Plan[] {
  const offsets = (rempli: (page: number) => number) =>
    Int32Array.from({ length: PAGES }, (_, page) => rempli(page));
  const vide = offsets(() => -1);
  const uneSeule = offsets((page) => (page ? -1 : 4));
  const tout = offsets((page) => page * 8);
  const sansPremiere = offsets((page) => (page ? page * 8 : -1));
  const inverse = offsets((page) => (PAGES - 1 - page) * 8);
  const decale = offsets((page) => (page < PAGES - 1 ? (page + 1) * 8 : -1));
  return [
    { offsets: vide, coupeProcesseur: false },
    { offsets: uneSeule, coupeProcesseur: false },
    { offsets: tout, coupeProcesseur: false },
    { offsets: tout, coupeProcesseur: true },
    { offsets: sansPremiere, coupeProcesseur: true },
    { offsets: tout, coupeProcesseur: true },
    { offsets: inverse, coupeProcesseur: true, descendante: true },
    { offsets: decale, coupeProcesseur: false },
    { offsets: tout, coupeProcesseur: true },
  ];
}

test('F4 : la table des lignes reste identique image après image, y compris vide, inversée et rejouée', () => {
  const neuf = monte(createWebgpuRowState, createWebgpuRowCommit);
  const ref = monte(referenceRowState, referenceRowCommit);
  const seq = images();
  for (let tour = 0; tour < seq.length; tour++) {
    if (tour === 8) {
      // Une époque de table relancée sans changement de résidence : invalide tous les rangs source.
      neuf.rows.tableEpoch += 1;
      ref.rows.tableEpoch += 1;
    }
    image(neuf, seq[tour]);
    image(ref, seq[tour]);
    assert.deepEqual(etatComplet(neuf.rows), etatComplet(ref.rows), `image ${tour}`);
  }
});

test('F5 : le rang d’une page vaut celui de la table de hachage, une page étrangère au rang usurpé ne trompe personne', () => {
  const pages = catalogue();
  const neuf = createWebgpuRowState(pages, SLOTS);
  const ref = referenceRowState(pages, SLOTS);
  for (const page of pages)
    assert.equal(neuf.pageIndexOf(page), ref.pageIndexOf(page), `page ${page.url}`);
  // Une page étrangère qui porterait le même `packedIndex` qu'une page réelle (aliasing) ne doit
  // être confondue avec elle sur aucun des deux côtés.
  const etrangere = { id: 999, url: 'x/0', packedIndex: 0 } as unknown as PageRec;
  assert.equal(neuf.pageIndexOf(etrangere), undefined);
  assert.equal(ref.pageIndexOf(etrangere), undefined);
  // Une page sans rang du tout.
  const sansRang = { id: 998, url: 'x/1' } as unknown as PageRec;
  assert.equal(neuf.pageIndexOf(sansRang), undefined);
  assert.equal(ref.pageIndexOf(sansRang), undefined);
});
