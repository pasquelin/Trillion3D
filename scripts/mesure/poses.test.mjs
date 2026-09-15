// Lot formules communes : plancherDuModele, factorisée de 2 copies (la caméra s'y pose, les lampes
// s'y accrochent).
import test from 'node:test';
import assert from 'node:assert/strict';
import { plancherDuModele } from './poses.mjs';

test('plancherDuModele retombe au plan zéro quand la géométrie enjambe le sol', () => {
  assert.equal(plancherDuModele({ min: { y: -2 }, max: { y: 5 } }), 0);
});

test('plancherDuModele prend le bas de la boîte quand tout est au-dessus ou au-dessous du sol', () => {
  assert.equal(plancherDuModele({ min: { y: 2 }, max: { y: 8 } }), 2);
  assert.equal(plancherDuModele({ min: { y: -8 }, max: { y: -2 } }), -8);
});

test('plancherDuModele aux bornes exactes (min ou max à zéro) ne franchit pas le plan', () => {
  // min.y === 0 n'est pas « < 0 » : la boîte ne l'enjambe pas, le plancher reste min.y.
  assert.equal(plancherDuModele({ min: { y: 0 }, max: { y: 5 } }), 0);
  // max.y === 0 n'est pas « > 0 » : même règle du bord opposé.
  assert.equal(plancherDuModele({ min: { y: -5 }, max: { y: 0 } }), -5);
});
