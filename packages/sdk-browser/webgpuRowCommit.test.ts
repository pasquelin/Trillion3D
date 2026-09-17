// Lot F, F4 et F5 : F4 (webgpuRowCommit.ts) ne réécrit plus la page, l'offset, l'époque et le rang
// inverse d'une ligne que `sourceRowOf` a rendue exacte ; F5 (webgpuRowState.ts) fait voyager le rang
// d'une page du catalogue sur la page elle-même (`packedIndex`) au lieu d'une table de hachage. Les
// oracles sont les implémentations d'avant le lot F, recopiées telles quelles dans
// `oracles/lignes-dessinables.mjs`. La comparaison porte sur l'état complet des tableaux après une suite
// d'images, pas sur une seule image : c'est là que les lignes réutilisées se voient.
//
// Ce que cette comparaison NE peut pas prouver : ce que le lot F n'a pas changé. `sourceRowOf` est
// le même mot pour mot des deux côtés, donc sa garde anti-alias ne se voit d'aucun écart — c'est
// `webgpuRowRecycle.test.ts` qui la prouve, directement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuRowState } from './webgpuRowState.ts';
import { createWebgpuRowCommit } from './webgpuRowCommit.ts';
import { referenceRowCommit, referenceRowState } from './bench/oracles/lignes-dessinables.mjs';
import type { PageRec } from './pageSelection.ts';
import {
  catalogue,
  etatComplet,
  image,
  monte,
  offsetsPar,
  PAGES,
  SLOTS,
  type Plan,
} from './webgpuRowCommitFixture.ts';

/**
 * Neuf images hostiles : vide, une seule page, tout résident, une page qui part par le DEVANT — les
 * rangs suivants se décalent alors d'un bloc, ce que F4 déplace au lieu de le réécrire — et son
 * retour, un ordre de coupe inversé qui interdit le déplacement, et une époque de table relancée.
 */
function images(): Plan[] {
  const vide = offsetsPar(() => -1);
  const uneSeule = offsetsPar((page) => (page ? -1 : 4));
  const tout = offsetsPar((page) => page * 8);
  const sansPremiere = offsetsPar((page) => (page ? page * 8 : -1));
  const inverse = offsetsPar((page) => (PAGES - 1 - page) * 8);
  const decale = offsetsPar((page) => (page < PAGES - 1 ? (page + 1) * 8 : -1));
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
