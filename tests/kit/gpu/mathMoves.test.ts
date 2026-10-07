// The kit's texture rules on their packages/math formula, against the expression it replaced.
//
// A full mip chain holds `floorLog2(side) + 1` levels, where it held `Math.floor(Math.log2(side))
// + 1`. A side is a `GPUIntegerCoordinate`, an unsigned long: `1 .. 2^32 − 1` once the empty
// sides are refused. On that span `Math.clz32` reads the side whole, and below 2^32 `Math.log2`
// keeps every integer apart from the power of two above it, so both give the same chain; a
// fractional side truncates in `clz32` as `Math.floor` rounds the logarithm. The sweep holds every
// chain length the same: every side to 2^14, the powers of two and their neighbours, and Halton
// sides, whole and fractional, up to 2^32.
import test from 'node:test'
import assert from 'node:assert/strict'
import { floorLog2 } from '../../../packages/math/src/scalar/integers.ts'
import { HALTON_SWEEP, haltonSpan } from '../../../packages/math/src/sequence/sweep.fixture.ts'

/** The old chain length. */
const oldChain = (side: number) => Math.floor(Math.log2(side)) + 1

test('a full mip chain counts the same levels on every texture side', () => {
  const sides: number[] = [2 ** 32 - 1]
  for (let side = 1; side <= 2 ** 14; side++) sides.push(side)
  for (let k = 0; k < 32; k++) sides.push(2 ** k - 1, 2 ** k, 2 ** k + 1)
  for (let i = 1; i <= HALTON_SWEEP; i++)
    sides.push(Math.floor(haltonSpan(i, 2, 1, 2 ** 32)), haltonSpan(i, 3, 1, 2 ** 32))
  for (const side of sides.filter((side) => side >= 1 && side < 2 ** 32))
    assert.equal(floorLog2(side) + 1, oldChain(side), `side ${side}`)
})
