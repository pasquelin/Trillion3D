import assert from 'node:assert/strict';

/** `actual` equals `expected` number by number, within the float error of an attach's product. */
export const assertClose = (actual: ArrayLike<number>, expected: ArrayLike<number>, what = '') =>
  Array.from(expected, (value, i) =>
    assert.ok(Math.abs(actual[i] - value) < 1e-12, `${what}[${i}]: ${actual[i]} vs ${value}`),
  );
