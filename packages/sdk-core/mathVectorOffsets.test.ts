import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { copyScaledVector3, crossVector3, dotVector3, lengthSqVector3 } from './mathVector.ts';
import { assertBits } from './bench/oracles/volumes.ts';

/** Four vectors flat in one buffer, read at an offset: the form the engine's batches use. */
const buffer = new Float64Array([
  0,
  0,
  3,
  -4,
  12,
  NaN,
  1,
  -1,
  Infinity,
  -Infinity,
  1,
  5e-324,
  -5e-324,
  1,
]);
const at = (i: number) => 2 + i * 3;
const three = (i: number) => new THREE.Vector3().fromArray(buffer, at(i));
const UNTOUCHED = [7, 7, 7];

test('dotVector3 at offsets: the same bits as a.dot(b) on the vectors read there', () => {
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      assert.ok(Object.is(dotVector3(buffer, buffer, at(i), at(j)), three(i).dot(three(j))));
});

test('crossVector3 at offsets: written where asked, the same bits as a.crossVectors(b)', () => {
  const out = new Float64Array(9).fill(7);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      crossVector3(out, buffer, buffer, 3, at(i), at(j));
      assertBits(
        out.subarray(3, 6),
        new THREE.Vector3().crossVectors(three(i), three(j)).toArray(),
      );
      assertBits(out.subarray(0, 3), UNTOUCHED);
      assertBits(out.subarray(6, 9), UNTOUCHED);
    }
});

test('lengthSqVector3 at an offset: the same bits as v.lengthSq() on the vector read there', () => {
  for (let i = 0; i < 4; i++)
    assert.ok(Object.is(lengthSqVector3(buffer, at(i)), three(i).lengthSq()));
});

test('copyScaledVector3 at offsets: written where asked, the same bits as copy(a).multiplyScalar(s)', () => {
  const out = new Float64Array(9).fill(7);
  for (let i = 0; i < 4; i++)
    for (const s of [1.5, -0, NaN, Infinity]) {
      copyScaledVector3(out, buffer, s, 6, at(i));
      assertBits(out.subarray(6, 9), three(i).multiplyScalar(s).toArray());
      assertBits(out.subarray(0, 6), [...UNTOUCHED, ...UNTOUCHED]);
    }
});
