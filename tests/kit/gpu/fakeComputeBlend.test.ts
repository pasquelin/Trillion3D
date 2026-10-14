// The double runs the transparent compaction at the workgroups the host dispatched, as a device
// does: a host that dispatches too few leaves groups uncounted here too, where the double once ran
// one thread for each the uniform counted whatever the dispatch.
import test from 'node:test'
import assert from 'node:assert/strict'
import { simulateComputeDispatch } from './fakeCompute.ts'

const GROUPS = 100
/** Sitting in every group count before the pass: a count it did not write. */
const UNWRITTEN = 7

/** The compaction's group with `groupCount` groups of no entry, every count unwritten. */
function compaction() {
  const buffers = Array.from({ length: 9 }, () => new Uint32Array(1))
  buffers[1] = Uint32Array.of(0, GROUPS, 0, 0, 0, 0, 0, 0)
  buffers[3] = new Uint32Array(GROUPS).fill(UNWRITTEN)
  return {
    counts: buffers[3],
    bind: {
      entries: buffers.map((data, binding) => ({
        binding,
        resource: { buffer: { data: new Uint8Array(data.buffer) } },
      })),
    },
  }
}

test('the compaction counts the groups its dispatch reaches, and those alone', () => {
  const pipeline = { entryPoint: 'countTransparentGroups' }
  const short = compaction()
  simulateComputeDispatch(pipeline, short.bind, undefined, undefined, 1)
  assert.deepEqual([...short.counts.subarray(0, 64)], new Array(64).fill(0))
  assert.deepEqual([...short.counts.subarray(64)], new Array(GROUPS - 64).fill(UNWRITTEN))
  const whole = compaction()
  simulateComputeDispatch(pipeline, whole.bind, undefined, undefined, 2)
  assert.deepEqual([...whole.counts], new Array(GROUPS).fill(0))
})
