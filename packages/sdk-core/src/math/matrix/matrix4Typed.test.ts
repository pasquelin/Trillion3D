import test from 'node:test';
import assert from 'node:assert/strict';
import { multiplyMatrix4 } from './matrix4.ts';
import { multiplyMatrix4Typed } from './matrix4Typed.ts';

const translation = (x: number, y: number, z: number) =>
  Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

test('multiplyMatrix4Typed: a Float32Array output holds the double product rounded once per term', () => {
  const a = Float32Array.from([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 0.1]);
  const b = [0.3, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1];
  const expected = multiplyMatrix4(
    new Float64Array(16),
    Float64Array.from(a),
    Float64Array.from(b),
  );
  const out = multiplyMatrix4Typed(new Float32Array(16), a, b);
  assert.ok(out instanceof Float32Array);
  assert.deepEqual([...out], [...Float32Array.from(expected)]);
});

test('multiplyMatrix4Typed: the output may alias an input', () => {
  const a = Float32Array.from(translation(2, 3, 4));
  multiplyMatrix4Typed(a, a, translation(1, 1, 1));
  assert.deepEqual([a[12], a[13], a[14]], [3, 4, 5]);
});
