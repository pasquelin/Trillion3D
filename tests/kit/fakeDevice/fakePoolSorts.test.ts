// The double replays a pool sort by the program its pipeline runs (`fakePoolSorts.ts`): a pool sort
// it does not know stops the run, where a buffer label once sent both silently to nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { simulateComputeDispatch } from './fakeCompute.ts'
import { SELECTION_HEADER_WORDS } from '../../../packages/sdk-browser/src/geometry/dag/readoutWords.ts'

/** A four-buffer pool sort group over `use`, an empty readout and the uniform `uniform`. */
const group = (use: number[], uniform: number[]) => ({
  entries: [use, new Array(64).fill(0), new Array(SELECTION_HEADER_WORDS + 4).fill(0), uniform].map(
    (data, binding) => ({
      binding,
      resource: { buffer: { data: new Uint8Array(Uint32Array.from(data).buffer) } },
    }),
  ),
})
const sort = (code: string) => ({ entryPoint: 'poolScatter', module: { code } })

test('a pool sort the double does not replay stops the run', () => {
  assert.throws(
    () => simulateComputeDispatch(sort('an unknown program'), group([0, 0, 0], [0, 0, 0, 0])),
    /does not replay/,
  )
})
