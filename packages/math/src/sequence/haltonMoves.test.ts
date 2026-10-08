// `halton` mirrors a 32-bit word in base 2 and takes the integer quotient in any other integer
// base: on every index the sweep and the word edges reach, in bases 2 to 13 and a fractional one,
// each term keeps its bits; an input outside those paths runs the loop it ran before.
import assert from 'node:assert/strict'
import test from 'node:test'
import { halton } from './halton.ts'
import { haltonBefore } from './haltonBefore.fixture.ts'
import { HALTON_SWEEP } from './sweep.fixture.ts'

test('halton: the word mirror and the integer quotient keep every bit', () => {
  const indices: number[] = [0, -0, -1, -2.5, 0.5, 1.5, NaN, 2 ** -1074, 1e-300, 2 ** 40, 1e17]
  for (let k = 0; k <= 34; k++) indices.push(2 ** k - 1, 2 ** k, 2 ** k + 1, 2 ** k + 0.5)
  for (let k = 0; k <= HALTON_SWEEP; k++) indices.push(k, Math.imul(k, 0x9e3779b1) >>> 0)
  for (const base of [2, 3, 4, 5, 7, 11, 13, 2.5, -3])
    for (const index of indices) {
      const old = haltonBefore(index, base),
        now = halton(index, base)
      if (!Object.is(old, now)) assert.fail(`halton(${index}, ${base}): old ${old}, new ${now}`)
    }
})
