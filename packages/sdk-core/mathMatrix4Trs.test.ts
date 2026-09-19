import test from 'node:test';
import assert from 'node:assert/strict';
import {
  basisMatrix4,
  composeMatrix4,
  decomposeMatrix4,
  uniformScaleMatrix4,
} from './mathMatrix4Trs.ts';
import { determinantMatrix4 } from './mathMatrix4.ts';

const proche = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

test('composeMatrix4: identity and translation only, last row (0,0,0,1) exact', () => {
  const out = composeMatrix4(new Float64Array(16), [1, 2, 3], [0, 0, 0, 1], [1, 1, 1]);
  assert.deepEqual([...out], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);
});

test('composeMatrix4: 90° rotation around z, x and y columns swapped and signed', () => {
  const s = Math.SQRT1_2; // quaternion (0, 0, sin45, cos45)
  const out = composeMatrix4(new Float64Array(16), [0, 0, 0], [0, 0, s, s], [1, 1, 1]);
  assert.ok(proche(out[0], 0) && proche(out[1], 1), 'column x becomes +y');
  assert.ok(proche(out[4], -1) && proche(out[5], 0), 'column y becomes -x');
  assert.ok(proche(out[10], 1));
});

test('decomposeMatrix4: round-trip on a rigid pose (non-uniform scale, arbitrary rotation)', () => {
  const position = [4, -2, 7],
    quaternion = [0.1826, 0.3651, 0.5477, 0.7303], // deliberately unnormalised, near unit
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
    'scale',
  );
  const recompose = composeMatrix4(new Float64Array(16), p2, q2, s2);
  assert.ok(
    [...recompose].every((v, i) => proche(v, m[i], 1e-6)),
    'recomposition without shear',
  );
});

test('decomposeMatrix4: negative scale on a single axis, carried by x, determinant of the same sign', () => {
  const m = composeMatrix4(new Float64Array(16), [0, 0, 0], [0, 0, 0, 1], [-2, 3, 4]);
  const p = new Float64Array(3),
    q = new Float64Array(4),
    s = new Float64Array(3);
  decomposeMatrix4(m, p, q, s);
  assert.equal(Math.sign(s[0]), -1, 'x porte le signe');
  assert.ok(s[1] > 0 && s[2] > 0, 'y and z stay positive');
  assert.equal(Math.sign(s[0] * s[1] * s[2]), Math.sign(determinantMatrix4(m)));
});

test('decomposeMatrix4: zero scale on one axis, quaternion NaN — like dividing by a zero column length in the reference (checked against `three`)', () => {
  const m = composeMatrix4(new Float64Array(16), [1, 1, 1], [0, 0, 0, 1], [0, 2, 2]);
  const p = new Float64Array(3),
    q = new Float64Array(4),
    s = new Float64Array(3);
  decomposeMatrix4(m, p, q, s);
  assert.deepEqual([...p], [1, 1, 1]);
  assert.deepEqual([...s], [0, 2, 2]);
  assert.ok(
    q.every(Number.isNaN),
    'a zero column length divides by zero: NaN, not an arbitrary value',
  );
});

test('basisMatrix4: columns u, v, n then the origin, last row exact, written at an offset', () => {
  const out = new Float64Array(32).fill(NaN);
  basisMatrix4(out, [1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12], 16);
  assert.ok([...out.subarray(0, 16)].every(Number.isNaN), 'nothing before the offset');
  assert.deepEqual([...out.subarray(16)], [1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 10, 11, 12, 1]);
});

test('uniformScaleMatrix4: the diagonal scaled, the centre in the last column, the rest zero', () => {
  const out = uniformScaleMatrix4(new Float64Array(16).fill(NaN), 2.5, [7, 8, 9]);
  assert.deepEqual([...out], [2.5, 0, 0, 0, 0, 2.5, 0, 0, 0, 0, 2.5, 0, 7, 8, 9, 1]);
});
