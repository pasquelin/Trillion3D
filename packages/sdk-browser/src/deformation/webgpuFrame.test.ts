import test from 'node:test'
import assert from 'node:assert/strict'
import { rootMark } from './halfFloat.ts'
import { fromHalf } from '../../../math/src/float/half.ts'
import { lcgRandom } from '../../../math/src/sequence/random.ts'

/** The reach the GPU cut reads of `reach`: the half float `rootMark` packs in the high bits. */
const reachBits = (reach: number) => rootMark({ mark: 0, reach: reach }) >>> 16
/** A positive half float's value, as `unpack2x16float` reads it: all exponent bits set is infinity. */
const halfValue = (bits: number) => (bits >= 0x7c00 ? Infinity : fromHalf(bits))

test('the reach the GPU cut reads is the smallest half float at or above the CPU one', () => {
  const random = lcgRandom(357)
  for (let k = 0; k < 20000; k++) {
    const x = 2 ** (random() * 44 - 26)
    const bits = reachBits(x)
    assert.ok(halfValue(bits) >= x, `${x}`)
    assert.ok(halfValue(bits - 1) < x, `${x} is not the smallest`)
  }
  assert.equal(reachBits(0), 0)
  assert.equal(halfValue(reachBits(1e9)), Infinity)
  // The mark keeps its low bits, the reach rides above them.
  assert.equal(rootMark({ mark: 0b101, reach: 1 }) & 0xffff, 0b101)
  assert.equal(halfValue(rootMark({ mark: 0b101, reach: 1 }) >>> 16), 1)
})
