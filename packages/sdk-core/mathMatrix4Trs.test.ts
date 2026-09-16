import test from 'node:test';
import assert from 'node:assert/strict';
import { composeMatrix4, decomposeMatrix4 } from './mathMatrix4Trs.ts';
import { determinantMatrix4 } from './mathMatrix4.ts';

const proche = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

test('composeMatrix4 : identité et translation seule, dernière ligne (0,0,0,1) exacte', () => {
  const out = composeMatrix4(new Float64Array(16), [1, 2, 3], [0, 0, 0, 1], [1, 1, 1]);
  assert.deepEqual([...out], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);
});

test('composeMatrix4 : rotation de 90° autour de z, colonnes x et y échangées et signées', () => {
  const s = Math.SQRT1_2; // quaternion (0, 0, sin45, cos45)
  const out = composeMatrix4(new Float64Array(16), [0, 0, 0], [0, 0, s, s], [1, 1, 1]);
  assert.ok(proche(out[0], 0) && proche(out[1], 1), 'colonne x devient +y');
  assert.ok(proche(out[4], -1) && proche(out[5], 0), 'colonne y devient -x');
  assert.ok(proche(out[10], 1));
});

test('decomposeMatrix4 : rond-trip sur une pose rigide (échelle non uniforme, rotation quelconque)', () => {
  const position = [4, -2, 7],
    quaternion = [0.1826, 0.3651, 0.5477, 0.7303], // non normalisé volontairement proche de l'unité
    echelle = [2, 0.5, 3];
  const n = Math.hypot(...quaternion);
  const q = quaternion.map((c) => c / n) as [number, number, number, number];
  const m = composeMatrix4(new Float64Array(16), position, q, echelle);
  const p2 = new Float64Array(3),
    q2 = new Float64Array(4),
    s2 = new Float64Array(3);
  decomposeMatrix4(m, p2, q2, s2);
  assert.ok(
    [...p2].every((v, i) => proche(v, position[i])),
    'position',
  );
  assert.ok(
    [...s2].every((v, i) => proche(v, echelle[i])),
    'échelle',
  );
  const recompose = composeMatrix4(new Float64Array(16), p2, q2, s2);
  assert.ok(
    [...recompose].every((v, i) => proche(v, m[i], 1e-6)),
    'recomposition sans cisaillement',
  );
});

test('decomposeMatrix4 : échelle négative sur un seul axe, portée par x, déterminant de même signe', () => {
  const m = composeMatrix4(new Float64Array(16), [0, 0, 0], [0, 0, 0, 1], [-2, 3, 4]);
  const p = new Float64Array(3),
    q = new Float64Array(4),
    s = new Float64Array(3);
  decomposeMatrix4(m, p, q, s);
  assert.equal(Math.sign(s[0]), -1, 'x porte le signe');
  assert.ok(s[1] > 0 && s[2] > 0, 'y et z restent positifs');
  assert.equal(Math.sign(s[0] * s[1] * s[2]), Math.sign(determinantMatrix4(m)));
});

test('decomposeMatrix4 : échelle nulle sur un axe, quaternion NaN — comme la division par une norme de colonne nulle chez la référence (vérifié contre `three`)', () => {
  const m = composeMatrix4(new Float64Array(16), [1, 1, 1], [0, 0, 0, 1], [0, 2, 2]);
  const p = new Float64Array(3),
    q = new Float64Array(4),
    s = new Float64Array(3);
  decomposeMatrix4(m, p, q, s);
  assert.deepEqual([...p], [1, 1, 1]);
  assert.deepEqual([...s], [0, 2, 2]);
  assert.ok(
    q.every(Number.isNaN),
    'la norme de colonne nulle divise par zéro : NaN, pas une valeur arbitraire',
  );
});
