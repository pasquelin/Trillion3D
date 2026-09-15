import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crossVector3,
  dotVector3,
  transformAffinePoint,
  transformHomogeneousPoint,
} from './mathVector.ts';

test('dotVector3 : produit scalaire des trois premières composantes seulement', () => {
  assert.equal(dotVector3([1, 2, 3], [4, 5, 6]), 32);
  assert.equal(dotVector3([1, 0, 0], [0, 1, 0]), 0);
});

test('crossVector3 : x × y = z, règle de la main droite', () => {
  const out = crossVector3(new Float64Array(3), [1, 0, 0], [0, 1, 0]);
  assert.deepEqual([...out], [0, 0, 1]);
});

test('crossVector3 : vecteurs génériques, les trois composantes croisées', () => {
  const out = crossVector3(new Float64Array(3), [1, 2, 3], [4, 5, 6]);
  assert.deepEqual([...out], [-3, 6, -3]);
});

test("crossVector3 : la sortie peut aliasser l'une ou l'autre entrée, six lectures avant écriture", () => {
  const a: [number, number, number] = [1, 2, 3],
    b: [number, number, number] = [4, 5, 6];
  const attendu = crossVector3(new Float64Array(3), a, b);
  const surA = Float64Array.from(a);
  crossVector3(surA, surA, b);
  assert.deepEqual([...surA], [...attendu], 'out === a');
  const surB = Float64Array.from(b);
  crossVector3(surB, a, surB);
  assert.deepEqual([...surB], [...attendu], 'out === b');
});

test('crossVector3 : décalage de sortie (outOffset), le reste du tampon inchangé', () => {
  const out = new Float64Array(6).fill(-1);
  crossVector3(out, [1, 0, 0], [0, 1, 0], 3);
  assert.deepEqual([...out], [-1, -1, -1, 0, 0, 1]);
});

test('transformAffinePoint : identité laisse le point inchangé, translation seule décale', () => {
  const identite = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];
  const out = transformAffinePoint(new Float64Array(3), identite, 1, 2, 3);
  assert.deepEqual([...out], [6, 8, 10]);
});

test('transformAffinePoint : sans division perspective même sur une matrice non affine', () => {
  // Dernière ligne (2, 0, 0, 1) au lieu de (0, 0, 0, 1) : la fonction ignore cette ligne par
  // construction, donc son résultat ne dépend que des trois premières lignes.
  const m = [1, 0, 0, 2, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const out = transformAffinePoint(new Float64Array(3), m, 3, 4, 5);
  assert.deepEqual([...out], [3, 4, 5]);
});

test('transformHomogeneousPoint : porte la quatrième composante, division laissée à l’appelant', () => {
  // Matrice de projection perspective simple : w = -z.
  const proj = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0];
  const out = transformHomogeneousPoint(new Float64Array(4), proj, 2, 4, -10);
  assert.deepEqual([...out], [2, 4, -10, 10]);
});
