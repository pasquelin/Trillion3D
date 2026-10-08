// `nextPow2` shifts up to 2^30 and writes 2^31 and 2^32 out: every power's neighbours, the sweep
// of (1, 2^32] and the inputs past it give the same number or the same error.
import assert from 'node:assert/strict'
import test from 'node:test'
import { nextPow2 } from './integers.ts'
import { nextPow2Before } from './integersBefore.fixture.ts'
import { HALTON_SWEEP, haltonSpan } from '../sequence/sweep.fixture.ts'
import { HOSTILE_VALUES } from '../sequence/moves.fixture.ts'

const outcome = (f: (v: number) => number, v: number) => {
  try {
    return f(v)
  } catch (error) {
    return `${(error as Error).name}: ${(error as Error).message}`
  }
}

test('nextPow2: the shift keeps every result and every error', () => {
  const values = [...HOSTILE_VALUES]
  for (let k = 0; k <= 34; k++) {
    const p = 2 ** k
    values.push(p, p - 1, p + 1, p - 0.5, p + 0.5, p * (1 - 2 ** -53), p * (1 + 2 ** -52))
  }
  for (let i = 1; i <= HALTON_SWEEP; i++)
    values.push(haltonSpan(i, 2, 1, 2 ** 32), 2 ** haltonSpan(i, 3, 0, 32))
  for (const v of values) {
    const old = outcome(nextPow2Before, v),
      now = outcome(nextPow2, v)
    if (!Object.is(old, now)) assert.fail(`nextPow2(${v}): old ${old}, new ${now}`)
  }
})
