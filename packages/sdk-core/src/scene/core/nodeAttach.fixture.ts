/** The first number where `actual` and `expected` differ by more than `tolerance` (the float error
 *  of an attach's product by default, to the bit with 0), or null when none does: the test asserts. */
export function mismatch(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  tolerance = 1e-12,
) {
  if (actual.length !== expected.length) return `length ${actual.length} vs ${expected.length}`;
  for (let i = 0; i < expected.length; i++)
    if (!(Math.abs(actual[i] - expected[i]) <= tolerance))
      return `[${i}]: ${actual[i]} vs ${expected[i]}`;
  return null;
}
