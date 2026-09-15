// Lot F, F6 : `ordonneCoupeTransparente` (webgpuBlendSelection.ts) ne trie plus une coupe déjà dans
// l'ordre source ; un parcours le constate, là où un `Array.prototype.sort` inconditionnel triait à
// chaque image. Le test refuse tout couple qui ne compare pas franchement « inférieur ou égal » (une
// clé NaN le fait échouer), et retombe alors sur le tri complet. L'oracle est le tri inconditionnel
// d'avant le lot F, recopié tel quel dans `oracles/f-transparents.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ordonneCoupeTransparente } from './webgpuBlendSelection.ts';
import { referenceOrdonneCoupe } from '../../scripts/mesure/calculs/oracles/f-transparents.mjs';
import type { PageRec } from './pageSelection.ts';

const rec = (id: number, sourceOrder?: number) => ({ id, sourceOrder }) as unknown as PageRec;

function memeOrdre(coupe: PageRec[], attendu: PageRec[]) {
  assert.equal(coupe.length, attendu.length);
  for (let i = 0; i < coupe.length; i++) assert.equal(coupe[i], attendu[i], `position ${i}`);
}

test('une coupe vide ou à un seul élément ne bouge pas', () => {
  assert.deepEqual(ordonneCoupeTransparente([]), []);
  const seul = rec(0);
  memeOrdre(ordonneCoupeTransparente([seul]), referenceOrdonneCoupe([seul]));
});

test('une coupe déjà dans l’ordre source n’est pas reconstruite (identité de tableau conservée)', () => {
  const [a, b, c] = [rec(0, 0), rec(1, 1), rec(2, 2)];
  const coupe = [a, b, c];
  const rendu = ordonneCoupeTransparente(coupe);
  assert.equal(rendu, coupe, 'le même tableau est rendu, en place');
  memeOrdre(coupe, [a, b, c]);
});

test('une coupe désordonnée retombe sur le même tri que la référence, id de repli compris', () => {
  const cas = [
    [rec(2), rec(0), rec(1)], // pas de sourceOrder : tri par id
    [rec(0, 5), rec(1, 1), rec(2, 3)], // sourceOrder décroissant puis croissant
    [rec(0, 2), rec(1, 2), rec(2, 1)], // clés égales : le tri doit rester stable
    [rec(0, -0), rec(1, 0), rec(2, -1)], // -0 et 0 comparent égal, jamais < ni >
  ];
  for (const coupe of cas) {
    const attendu = referenceOrdonneCoupe(coupe.slice());
    const obtenu = ordonneCoupeTransparente(coupe.slice());
    memeOrdre(obtenu, attendu);
  }
});

test('une clé sourceOrder NaN casse la comparaison « inférieur ou égal » et déclenche quand même le tri', () => {
  // ordreSource(NaN, x) et ordreSource(x, NaN) valent NaN : ni <= 0 ni > 0. Le raccourci du parcours
  // doit refuser ce couple et retomber sur `sort`, qui rend le même ordre que la référence (V8 est un
  // tri stable pour les deux appels, sur la même entrée).
  const coupe = [rec(0, 0), rec(1, NaN), rec(2, 2)];
  const attendu = referenceOrdonneCoupe(coupe.slice());
  const obtenu = ordonneCoupeTransparente(coupe.slice());
  memeOrdre(obtenu, attendu);
});

test('une coupe de grande taille, mélangée, rend le même ordre que la référence', () => {
  const coupe: PageRec[] = [];
  for (let i = 0; i < 500; i++) coupe.push(rec(i, (i * 37) % 500));
  const attendu = referenceOrdonneCoupe(coupe.slice());
  const obtenu = ordonneCoupeTransparente(coupe.slice());
  memeOrdre(obtenu, attendu);
});
