import assert from 'node:assert/strict';

/**
 * Fails on the first bitwise mismatch between two number sequences of the same length.
 * `Object.is` separates -0 from +0 and identifies NaN, which `===` does not. `label` names the
 * compared value in the message; without it, the component index alone is reported.
 */
export function assertBits(actual: ArrayLike<number>, expected: ArrayLike<number>, label?: string) {
  assert.equal(actual.length, expected.length, label);
  for (let i = 0; i < expected.length; i++)
    assert.ok(
      Object.is(actual[i], expected[i]),
      label === undefined
        ? `component ${i} : ${actual[i]} !== ${expected[i]}`
        : `${label}[${i}] : ${actual[i]} !== ${expected[i]}`,
    );
}
