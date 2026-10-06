// `encodeDraws.ts` uploads the rows whose bytes changed before it submits the cut, and the fallback
// draw path clears the marks too: a witness it skipped would keep another occupant's words once the
// visibility pass comes back on the same targets.
//
// The tree had no test for this module. `../../row/dirty.ts` holds the run walk and the
// marks; what nothing covered is the promise `uploadDirtyRows` makes to the frame — a row that did
// not change is not uploaded, and the marks it did change are cleared exactly once, so the next image
// uploads nothing. Without that promise every resting scene would rewrite its whole page table.
import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadDirtyRows } from './dirtyRows.ts'
import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

interface Write {
  /** The byte offset in the table the run starts at. */
  at: number
  /** How many bytes of it were written. */
  bytes: number
}

/** A session whose page table is a real buffer and whose queue records every write, so the test
 *  reads what the frame sent rather than how many times it was asked to send it. */
const session = (marks: number[], length = 8) => {
  const writes: Write[] = []
  const floats = new Float32Array(marks.length * PAGE_INFO_STRIDE)
  let cleared = 0
  const rt = {
    layout: {
      rows: {
        dirtyMarks: Uint8Array.from(marks),
        dirtyFrom: 0,
        dirtyTo: marks.length - 1,
        pageTableFloats: floats,
        clearDirty: () => {
          cleared++
          rt.layout.rows.dirtyMarks.fill(0)
          rt.layout.rows.dirtyTo = -1
        },
      },
    },
    vis: { pageTable: {} as GPUBuffer },
    gpu: {
      device: {
        queue: {
          writeBuffer: (
            _buffer: GPUBuffer,
            byteOffset: number,
            _src: ArrayBuffer,
            _from: number,
            bytes: number,
          ) => writes.push({ at: byteOffset, bytes }),
        },
      },
    },
    timing: { encodeCounts: { rowsUploaded: 0 } },
  } as unknown as WebgpuPagesRuntime
  return { rt, writes, floats, cleared: () => cleared, length }
}

test('a row table nothing marked uploads nothing, and says so', () => {
  const { rt, writes } = session([0, 0, 0, 0])
  uploadDirtyRows(rt)
  assert.deepEqual(writes, [], 'nothing changed: nothing is written')
  assert.equal(rt.timing.encodeCounts.rowsUploaded, 0)
})

test('one marked row is written once, and the count is the rows it wrote', () => {
  const { rt, writes } = session([0, 0, 1, 0, 0])
  uploadDirtyRows(rt)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].at, 2 * PAGE_INFO_STRIDE, 'the marked row, not the whole table')
  assert.equal(writes[0].bytes, PAGE_INFO_STRIDE, 'one row of bytes')
  assert.equal(rt.timing.encodeCounts.rowsUploaded, 1)
})

test('two runs of marked rows are two writes, not one that spans the gap between them', () => {
  const { rt, writes } = session([1, 1, 0, 0, 1])
  uploadDirtyRows(rt)
  assert.equal(writes.length, 2, 'each run is written on its own')
  assert.deepEqual(
    writes.map((w) => w.at),
    [0, 4 * PAGE_INFO_STRIDE],
    'at the rows they hold',
  )
  assert.deepEqual(
    writes.map((w) => w.bytes),
    [2 * PAGE_INFO_STRIDE, PAGE_INFO_STRIDE],
  )
  assert.equal(rt.timing.encodeCounts.rowsUploaded, 3, 'every row of both runs')
})

test('the marks are cleared once, so the next image of a resting scene uploads nothing', () => {
  const { rt, writes, cleared } = session([1, 0, 1])
  uploadDirtyRows(rt)
  assert.equal(writes.length, 2, 'the two marked rows, one write each')
  assert.equal(cleared(), 1, 'the marks are cleared exactly once')
  uploadDirtyRows(rt)
  assert.equal(writes.length, 2, 'and nothing is written the second time')
  assert.equal(rt.timing.encodeCounts.rowsUploaded, 0)
})

test('a run that reaches the last row is written whole: there is no zero after it to stop it', () => {
  const { rt, writes } = session([0, 1, 1])
  uploadDirtyRows(rt)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].at, PAGE_INFO_STRIDE, 'from the first marked row')
  assert.equal(writes[0].bytes, 2 * PAGE_INFO_STRIDE, 'both rows of the run')
})

test('no page table yet: nothing is written, and no table is required to ask', () => {
  const { rt, writes } = session([1, 1, 1])
  rt.vis.pageTable = undefined as unknown as GPUBuffer
  uploadDirtyRows(rt)
  assert.deepEqual(writes, [], 'the table arrives before the first rows do')
})
