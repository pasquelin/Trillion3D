import test from 'node:test';
import assert from 'node:assert/strict';
import { clampNumber, toSpherical, fromSpherical } from './spherical.ts';

test('clamping preserves interior and boundary values and rejects either excess', () => {
  for (const [value, expected] of [
    [-10, -2],
    [-2, -2],
    [3, 3],
    [7, 7],
    [20, 7],
  ])
    assert.equal(clampNumber(value, -2, 7), expected);
});

test('spherical coordinates describe cardinal and oblique directions in world units', () => {
  const cases = [
    [
      [0, 5, 0],
      [5, 0, 0],
    ],
    [
      [0, -5, 0],
      [5, 0, Math.PI],
    ],
    [
      [5, 0, 0],
      [5, Math.PI / 2, Math.PI / 2],
    ],
    [
      [0, 0, -5],
      [5, Math.PI, Math.PI / 2],
    ],
    [
      [2, 2 * Math.SQRT2, 2],
      [4, Math.PI / 4, Math.PI / 4],
    ],
  ];
  for (const [point, expected] of cases) {
    const out = new Float64Array(3);
    assert.equal(toSpherical(out, point), out);
    expected.forEach((value, i) => assert.ok(Math.abs(out[i] - value) < 1e-12));
    assert.equal(fromSpherical(out, expected), out);
    point.forEach((value, i) => assert.ok(Math.abs(out[i] - value) < 1e-12));
  }
});

test('a vanishing offset keeps the prior camera angles; a resolvable one sets them', () => {
  const out = new Float64Array([9, 0.3, 0.8]);
  toSpherical(out, [0, 0, 0]);
  assert.deepEqual([...out], [0, 0.3, 0.8]);
  toSpherical(out, [1e-3, 0, 0]);
  assert.deepEqual([...out], [1e-3, Math.PI / 2, Math.PI / 2]);
});
