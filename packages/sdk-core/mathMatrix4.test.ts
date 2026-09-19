import test from 'node:test';
import assert from 'node:assert/strict';
import { determinantMatrix4, linearPartDeterminant, multiplyMatrix4 } from './mathMatrix4.ts';

const IDENTITY = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const translation = (x: number, y: number, z: number) =>
  Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

test('multiplyMatrix4: identity is neutral on the left and on the right', () => {
  const m = Float64Array.from([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53]);
  const out = new Float64Array(16);
  multiplyMatrix4(out, IDENTITY, m);
  assert.deepEqual([...out], [...m]);
  multiplyMatrix4(out, m, IDENTITY);
  assert.deepEqual([...out], [...m]);
});

test('multiplyMatrix4: two translations compose into one, position column summed', () => {
  const out = new Float64Array(16);
  multiplyMatrix4(out, translation(1, 2, 3), translation(4, 5, 6));
  assert.deepEqual([out[12], out[13], out[14]], [5, 7, 9]);
});

test('multiplyMatrix4: the output may alias either input, sixteen reads before write', () => {
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

test('multiplyMatrix4: no sum started at zero, a term negative zero may survive', () => {
  // `a` carries -0 on the whole of row 0; `b` carries +0 on the whole of column 0: the four products
  // of `out[0]` are all -0. An implementation that initialised the accumulator to literal `0`
  // would always yield +0 (0 + -0 = +0 in IEEE 754), whatever the sign of the added terms.
  const a = new Float64Array(16).fill(0),
    b = new Float64Array(16).fill(0);
  for (let k = 0; k < 4; k++) a[k * 4] = -0;
  for (let k = 0; k < 4; k++) b[k] = 0;
  const out = multiplyMatrix4(new Float64Array(16), a, b);
  assert.ok(Object.is(out[0], -0), `expected -0, got ${out[0]}`);

  const sommeDepuisZero = (row: number, col: number) => {
    let somme = 0;
    for (let k = 0; k < 4; k++) somme += a[k * 4 + row] * b[col * 4 + k];
    return somme;
  };
  assert.ok(Object.is(sommeDepuisZero(0, 0), 0), 'the rejected form would yield +0, not -0');
});

test('determinantMatrix4: affine diagonal matrix, product of the three factors', () => {
  const m = Float64Array.from([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 5, 0, 7, 11, 13, 1]);
  assert.equal(determinantMatrix4(m), 30);
});

test('determinantMatrix4: a reflection on a single axis yields a negative determinant', () => {
  const m = Float64Array.from([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  assert.equal(determinantMatrix4(m), -1);
});

test('linearPartDeterminant: same sign and same value to the ulp as determinantMatrix4 on an affine matrix', () => {
  // Linear block with no off-diagonal zero: a formula that dropped a term would show here.
  const m = Float64Array.from([2, 4, 7, 0, 1, 5, 8, 0, 3, 6, 10, 0, 5, -7, 11, 1]);
  const complet = determinantMatrix4(m),
    lineaire = linearPartDeterminant(m);
  assert.equal(Math.sign(complet), Math.sign(lineaire));
  assert.ok(Math.abs(complet - lineaire) <= 1e-9 * Math.abs(complet), `${complet} vs ${lineaire}`);
});
