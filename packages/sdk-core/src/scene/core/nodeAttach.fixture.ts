import assert from 'node:assert/strict';

/** `actual` equals `expected` number by number, within the float error of an attach's product
 *  by default, or to the bit with a `tolerance` of 0. */
export function assertClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  what = '',
  tolerance = 1e-12,
) {
  assert.equal(actual.length, expected.length, `${what}: length`);
  for (let i = 0; i < expected.length; i++)
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= tolerance,
      `${what}[${i}]: ${actual[i]} vs ${expected[i]}`,
    );
}
