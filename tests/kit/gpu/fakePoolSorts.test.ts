// The double replays a pool sort by the program its pipeline runs (`fakePoolSorts.ts`): the rows'
// victim queue lands in the readout as `rowEvictSortWgsl.ts` writes it, and a pool sort the double
// does not know stops the run, where a buffer label once sent both silently to nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { simulateComputeDispatch } from './fakeCompute.ts'
import { ROW_SORT_WGSL } from '../../../packages/sdk-browser/src/webgpu/row/rowEvictSortWgsl.ts'
import { ROW_USE_WORDS } from '../../../packages/sdk-browser/src/webgpu/row/rowWords.ts'
import { SELECTION_HEADER_WORDS } from '../../../packages/sdk-browser/src/gpu/dag/readoutWords.ts'

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

test('the rows’ sort writes their queue: the oldest rows’ pages, a row in use never', () => {
  const clock = 100
  // Per row: its last use, its walk word, its page; the second row was used a frame ago.
  const rows = [10, 0, 7, 99, 0, 8, 50, 0, 9]
  assert.equal(rows.length, 3 * ROW_USE_WORDS)
  const bind = group(rows, [clock, 3, 0, 4])
  simulateComputeDispatch(sort(ROW_SORT_WGSL), bind)
  const out = new Uint32Array(bind.entries[2].resource.buffer.data.buffer)
  assert.deepEqual([...out.subarray(0, 3)], [2, 2, clock + 1])
  assert.deepEqual([...out.subarray(SELECTION_HEADER_WORDS, SELECTION_HEADER_WORDS + 2)], [7, 9])
})

test('a pool sort the double does not replay stops the run', () => {
  assert.throws(
    () => simulateComputeDispatch(sort('an unknown program'), group([0, 0, 0], [0, 0, 0, 0])),
    /does not replay/,
  )
})
