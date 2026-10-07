import assert from 'node:assert/strict'

/** Asserts `actual` holds as many numbers as `expected`, each within `eps` of its own. */
export function near(
  actual: ArrayLike<number> | undefined,
  expected: readonly number[],
  label: string,
  eps = 1e-9,
) {
  assert.equal(actual?.length, expected.length, label)
  for (let k = 0; k < expected.length; k++)
    assert.ok(
      Math.abs(actual![k] - expected[k]) <= eps,
      `${label}: ${Array.from(actual!)} is not ${expected}`,
    )
}
