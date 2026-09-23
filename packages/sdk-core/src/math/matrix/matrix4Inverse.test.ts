import test from 'node:test';
import assert from 'node:assert/strict';
import { invertMatrix4 } from './matrix4Inverse.ts';
import { multiplyMatrix4 } from './matrix4.ts';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translation = (x: number, y: number, z: number) =>
  Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

test('invertMatrix4: inverts a translation, the product yields exactly the identity', () => {
  const m = translation(3, -5, 7);
  const inv = invertMatrix4(new Float64Array(16), m);
  assert.deepEqual([inv[12], inv[13], inv[14]], [-3, 5, -7]);
  const produit = multiplyMatrix4(new Float64Array(16), m, inv);
  assert.deepEqual([...produit], IDENTITY);
});

test('invertMatrix4: inverts a non-uniform scale, reciprocal diagonal', () => {
  const m = Float64Array.from([2, 0, 0, 0, 0, 4, 0, 0, 0, 0, 5, 0, 0, 0, 0, 1]);
  const inv = invertMatrix4(new Float64Array(16), m);
  assert.deepEqual([inv[0], inv[5], inv[10]], [0.5, 0.25, 0.2]);
});

test('invertMatrix4: an exactly zero determinant yields the zero matrix, as documented', () => {
  const singuliere = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); // two equal columns
  const out = invertMatrix4(new Float64Array(16).fill(9), singuliere);
  assert.deepEqual([...out], new Array(16).fill(0));
});

test('invertMatrix4: the output may alias the input, sixteen reads before write', () => {
  const m = translation(1, 2, 3);
  const attendu = invertMatrix4(new Float64Array(16), m);
  const alias = Float64Array.from(m);
  invertMatrix4(alias, alias);
  assert.deepEqual([...alias], [...attendu]);
});
