import test from 'node:test';
import assert from 'node:assert/strict';
import { determinantMatrix4, linearPartDeterminant, multiplyMatrix4 } from './mathMatrix4.ts';

const IDENTITY = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const translation = (x: number, y: number, z: number) =>
  Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

test('multiplyMatrix4 : identité neutre à gauche et à droite', () => {
  const m = Float64Array.from([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53]);
  const out = new Float64Array(16);
  multiplyMatrix4(out, IDENTITY, m);
  assert.deepEqual([...out], [...m]);
  multiplyMatrix4(out, m, IDENTITY);
  assert.deepEqual([...out], [...m]);
});

test('multiplyMatrix4 : deux translations composent en une seule, colonne de position sommée', () => {
  const out = new Float64Array(16);
  multiplyMatrix4(out, translation(1, 2, 3), translation(4, 5, 6));
  assert.deepEqual([out[12], out[13], out[14]], [5, 7, 9]);
});

test("multiplyMatrix4 : la sortie peut aliasser l'une ou l'autre entrée, seize lectures avant écriture", () => {
  const a = translation(2, 3, 4),
    b = translation(5, 6, 7);
  const attendu = multiplyMatrix4(new Float64Array(16), a, b);
  const surA = Float64Array.from(a);
  multiplyMatrix4(surA, surA, b);
  assert.deepEqual([...surA], [...attendu], 'out === a');
  const surB = Float64Array.from(b);
  multiplyMatrix4(surB, a, surB);
  assert.deepEqual([...surB], [...attendu], 'out === b');
});

test('multiplyMatrix4 : aucune somme commencée à zéro, un zéro négatif de terme peut survivre', () => {
  // `a` porte -0 sur toute la ligne 0 ; `b` porte +0 sur toute la colonne 0 : les quatre produits de
  // `out[0]` valent tous -0. Une implémentation qui initialiserait l'accumulateur à `0` littéral
  // rendrait toujours +0 (0 + -0 = +0 en IEEE 754), quel que soit le signe des termes ajoutés.
  const a = new Float64Array(16).fill(0),
    b = new Float64Array(16).fill(0);
  for (let k = 0; k < 4; k++) a[k * 4] = -0;
  for (let k = 0; k < 4; k++) b[k] = 0;
  const out = multiplyMatrix4(new Float64Array(16), a, b);
  assert.ok(Object.is(out[0], -0), `attendu -0, reçu ${out[0]}`);

  const sommeDepuisZero = (row: number, col: number) => {
    let somme = 0;
    for (let k = 0; k < 4; k++) somme += a[k * 4 + row] * b[col * 4 + k];
    return somme;
  };
  assert.ok(Object.is(sommeDepuisZero(0, 0), 0), 'la forme rejetée rendrait +0, pas -0');
});

test('determinantMatrix4 : matrice diagonale affine, produit des trois facteurs', () => {
  const m = Float64Array.from([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 5, 0, 7, 11, 13, 1]);
  assert.equal(determinantMatrix4(m), 30);
});

test('determinantMatrix4 : réflexion sur un seul axe rend un déterminant négatif', () => {
  const m = Float64Array.from([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  assert.equal(determinantMatrix4(m), -1);
});

test('linearPartDeterminant : même signe et même valeur à l’ulp près que determinantMatrix4 sur une matrice affine', () => {
  // Bloc linéaire sans zéro hors diagonale : une formule qui perdrait un terme se verrait ici.
  const m = Float64Array.from([2, 4, 7, 0, 1, 5, 8, 0, 3, 6, 10, 0, 5, -7, 11, 1]);
  const complet = determinantMatrix4(m),
    lineaire = linearPartDeterminant(m);
  assert.equal(Math.sign(complet), Math.sign(lineaire));
  assert.ok(Math.abs(complet - lineaire) <= 1e-9 * Math.abs(complet), `${complet} vs ${lineaire}`);
});
