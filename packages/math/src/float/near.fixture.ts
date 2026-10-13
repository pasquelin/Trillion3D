import assert from 'node:assert/strict'

/** Asserts `actual` holds as many numbers as `expected`, each within `eps` of its own; a lone
 *  number stands for a list of one. */
export function near(
  actual: number | ArrayLike<number> | undefined,
  expected: number | ArrayLike<number>,
  label: string,
  eps = 1e-9,
) {
  const got = typeof actual === 'number' ? [actual] : actual,
    want = typeof expected === 'number' ? [expected] : expected
  assert.equal(got?.length, want.length, label)
  for (let k = 0; k < want.length; k++)
    assert.ok(
      Math.abs(got![k] - want[k]) <= eps,
      `${label}: ${Array.from(got!)} is not ${Array.from(want)}`,
    )
}

/** Whether `a` lies within `eps` of `b`. */
export const nearly = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps

/** Asserts `actual` lies within `rel · max(1, |expected|)` of `expected`: a relative bound past
 *  one, an absolute one below. */
export const nearRelative = (actual: number, expected: number, label: string, rel = 1e-9) =>
  near(actual, expected, label, rel * Math.max(1, Math.abs(expected)))
