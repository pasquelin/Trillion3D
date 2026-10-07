// The main thread is bounded by the view: the budget reads the cut's host
// tables on each eviction and each page arrival, so that read costs the same for a world and for
// the same world sixteen times larger. The work is counted, never timed: every typed array's
// `byteLength` read.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ruleDag } from './cutRule.fixture.ts'
import { placements } from './cutRuleBackends.fixture.ts'
import { packDagSelection } from '../../gpu/dag/pack.ts'
import { uploadResidency } from '../../gpu/dag/readiness.fixture.ts'

const dag = ruleDag(64)

const typedArray = Object.getPrototypeOf(Int32Array.prototype) as object,
  byteLength = Object.getOwnPropertyDescriptor(typedArray, 'byteLength')!

/** How many typed arrays `read` weighs. */
function weighed(read: () => number) {
  let count = 0
  Object.defineProperty(typedArray, 'byteLength', {
    ...byteLength,
    get(this: ArrayBufferView) {
      count++
      return byteLength.get!.call(this)
    },
  })
  try {
    assert.ok(read() > 0, 'the view holds something')
  } finally {
    Object.defineProperty(typedArray, 'byteLength', byteLength)
  }
  return count
}

test('reading the host bytes weighs as many tables for 2 placements as for 32', () => {
  const reads = (copies: number) => {
    // All in view, every page resident: the GPU kernel's readiness and its upload's change lists.
    const packed = packDagSelection(placements(dag, copies)),
      gpu = uploadResidency(packed, new Uint8Array(packed.pageCount).fill(1))
    return weighed(() => gpu.hostBytes)
  }
  assert.deepEqual(reads(32), reads(2))
})
