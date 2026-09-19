import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NORMAL_MATRIX_VALUES,
  composeMatrix4Batch,
  decomposeMatrix4Batch,
  invertMatrix4Batch,
  multiplyMatrix4Batch,
  normalMatrix3Batch,
} from './mathIndex.ts';
import { composeMatrix4 } from './mathMatrix4Trs.ts';

test('invertMatrix4Batch: inverts regular matrices and sets identity on singular', () => {
  const m1 = new Float64Array(16);
  composeMatrix4(m1, [1, 2, 3], [0, 0, 0, 1], [2, 2, 2]);
  const mSingular = new Float64Array(16); // all zeros is singular

  const mats = [m1, mSingular];
  const out = [new Float64Array(16), new Float64Array(16)];
  const singular = new Uint8Array(2);

  invertMatrix4Batch(out, mats, 2, singular);
  assert.equal(singular[0], 0);
  assert.equal(singular[1], 1);
  const prod = new Float64Array(16);
  multiplyMatrix4Batch([prod], [m1], [out[0]], 1);
  assert.ok(Math.abs(prod[0] - 1) < 1e-10);
  assert.ok(Math.abs(prod[12]) < 1e-10);
  assert.equal(out[1][0], 1);
  assert.equal(out[1][5], 1);
  assert.equal(out[1][10], 1);
  assert.equal(out[1][15], 1);
});

test('normalMatrix3Batch: computes 3×3 normal matrices', () => {
  const m = new Float64Array(16);
  composeMatrix4(m, [0, 0, 0], [0, 0, 0, 1], [2, 4, 8]);
  const out = new Float64Array(NORMAL_MATRIX_VALUES);
  normalMatrix3Batch(out, [m], 1);
  assert.ok(Math.abs(out[0] - 0.5) < 1e-10);
  assert.ok(Math.abs(out[4] - 0.25) < 1e-10);
  assert.ok(Math.abs(out[8] - 0.125) < 1e-10);
});

test('composeMatrix4Batch and decomposeMatrix4Batch: roundtrip', () => {
  const posIn = [new Float64Array([1, 2, 3])];
  const rotIn = [new Float64Array([0, 0, 0, 1])];
  const scaleIn = [new Float64Array([2, 3, 4])];
  const mats = [new Float64Array(16)];

  composeMatrix4Batch(mats, posIn, rotIn, scaleIn, 1);

  const posOut = [new Float64Array(3)];
  const rotOut = [new Float64Array(4)];
  const scaleOut = [new Float64Array(3)];
  decomposeMatrix4Batch(posOut, rotOut, scaleOut, mats, 1);

  assert.ok(Math.abs(posOut[0][0] - 1) < 1e-10);
  assert.ok(Math.abs(posOut[0][1] - 2) < 1e-10);
  assert.ok(Math.abs(posOut[0][2] - 3) < 1e-10);
  assert.ok(Math.abs(scaleOut[0][0] - 2) < 1e-10);
  assert.ok(Math.abs(scaleOut[0][1] - 3) < 1e-10);
  assert.ok(Math.abs(scaleOut[0][2] - 4) < 1e-10);
});
