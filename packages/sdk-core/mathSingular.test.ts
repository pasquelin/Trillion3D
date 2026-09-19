// The engine "singular matrix" rule (`mathSingular.ts`), the one `normalMatrix3` applies
// on the CPU and the WGSL kernel of `inverseTransposeWgsl.ts` applies on the GPU. This file
// tests the RULE alone; what a singular matrix becomes is tested in `mathMatrix3.test.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SINGULAR_DETERMINANT,
  SINGULAR_DETERMINANT_WGSL,
  adjugateFactor,
  linearPartScale,
  normalizedLinearDeterminant,
} from './mathSingular.ts';

/** A column-major 4×4 from its three linear-part columns. */
const lineaire = (a: number[], b: number[], c: number[]) =>
  Float64Array.from([...a, 0, ...b, 0, ...c, 0, 0, 0, 0, 1]);
const echelleUniforme = (s: number) => lineaire([s, 0, 0], [0, s, 0], [0, 0, s]);

test('the threshold does not judge scale: a uniform-scale rotation stays regular from 1e-7 to 1e7', () => {
  // The ABSOLUTE-threshold trap: the raw determinant of a uniform scale `s` is s³, hence 1e-21 at
  // s = 1e-7 — under any absolute threshold, while the matrix is perfectly invertible.
  // Normalised, the same matrix always has determinant 1/27, whatever its scale.
  for (const s of [1e-7, 1e-4, 1, 1e4, 1e7]) {
    const m = echelleUniforme(s);
    const normalise = normalizedLinearDeterminant(m);
    assert.ok(
      Math.abs(normalise - 1 / 27) < 1e-15,
      `scale ${s}: normalised determinant ${normalise} instead of 1/27`,
    );
    assert.equal(adjugateFactor(m, s * s * s), 1 / (s * s * s), `scale ${s}: regular factor`);
  }
});

test('a non-zero raw determinant of degenerate shape is declared singular', () => {
  // Almost parallel columns: the RAW determinant is 1e-19, so `det === 0` was false and the
  // factor was 1e19; the NORMALISED determinant is 1e-19 / 27 ≈ 3.7e-21, under the threshold.
  const m = lineaire([1, 0, 0], [1, 1e-19, 0], [0, 0, 1]);
  const brut = 1e-19;
  assert.notEqual(brut, 0, 'the raw determinant is not zero');
  assert.ok(
    Math.abs(normalizedLinearDeterminant(m)) <= SINGULAR_DETERMINANT,
    'normalised under threshold',
  );
  assert.equal(adjugateFactor(m, brut), 1, 'singular factor: the adjugate as-is');
});

test('an exactly zero determinant stays singular, as before', () => {
  const m = lineaire([1, 0, 0], [2, 0, 0], [0, 0, 1]);
  assert.equal(normalizedLinearDeterminant(m), 0);
  assert.equal(adjugateFactor(m, 0), 1);
});

test('a raw determinant cancelled by compensation yields the adjugate, even on a regular shape', () => {
  // The sum of the six products of a 4×4 determinant can land on EXACT zero where the same
  // matrix, columns divided by their scale, keeps a determinant far from the threshold: the two
  // roundings are not the same. The CPU divides by the RAW determinant — that is what keeps
  // the reference bits on every ordinary matrix — and a zero divisor yields nothing:
  // the adjugate alone, as the engine already did before this rule. The GPU, which divides by the
  // normalised determinant, does not have this case.
  const m = echelleUniforme(1);
  assert.ok(
    Math.abs(normalizedLinearDeterminant(m)) > SINGULAR_DETERMINANT,
    'the shape is regular',
  );
  assert.equal(adjugateFactor(m, 0), 1, 'zero raw determinant: the adjugate alone');
});

test('a zero, infinite or NaN scale yields no factor: the adjugate is to be replaced', () => {
  const cas: Array<[string, Float64Array]> = [
    ['zero', new Float64Array(16)],
    ['infinite', lineaire([Infinity, 0, 0], [0, 1, 0], [0, 0, 1])],
    ['NaN', lineaire([NaN, 0, 0], [0, 1, 0], [0, 0, 1])],
  ];
  for (const [quoi, m] of cas) {
    assert.ok(Number.isNaN(normalizedLinearDeterminant(m)), `${quoi}: normalised determinant NaN`);
    assert.equal(adjugateFactor(m, 1), null, `${quoi}: no factor`);
  }
});

test('scale is the sum of the nine absolute values of the 3×3 block, translation excluded', () => {
  const m = Float64Array.from([1, -2, 3, 9, -4, 5, -6, 9, 7, -8, 9, 9, 100, 200, 300, 1]);
  assert.equal(linearPartScale(m), 45);
});

test('the WGSL threshold is the constant rendered as text, not a second number', () => {
  assert.equal(Number(SINGULAR_DETERMINANT_WGSL), SINGULAR_DETERMINANT);
  assert.match(SINGULAR_DETERMINANT_WGSL, /^\d(\.\d+)?e[+-]\d+$/);
});
