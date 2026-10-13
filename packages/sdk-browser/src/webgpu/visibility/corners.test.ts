// A model scattered across the table that only moves forgets no occlusion history and sends no
// row: its corners are the rows pass's (`../../placement/rowWordsPass.ts`), derived from its new
// world, and a stale rectangle only moves a row between the two halves. A model whose pages are
// bounded elsewhere forgets and sends its own rows, not the terrain rows between them: the table
// must not keep one dirty interval, or a model whose rows sit at both ends of the table would drop
// the occlusion history of every row in between and send them all again.
import { runsOf } from '../row/dirty.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { forgetRewrittenRows, createCornerHold } from './corners.ts'
import { markRootRows, moveRootRows } from '../pages/render/movedRoot.ts'
import { createChangedRuns } from '../residency/ranges.ts'
import { createWebgpuRowState } from '../row/state.ts'
import { PAGE_INFO_STRIDE, ROW_WORDS } from '../../visibility/types.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import type { PageRec } from '../../page/selection/types.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { uploadDirtyRows } from '../pages/render/dirtyRows.ts'

const ROWS = 1000,
  MODEL_ROWS = [3, 4, 400, 401, 402, 997]

/** A table of `ROWS` drawn rows, the model's clusters scattered in it, every witness up to date. */
function scatteredScene() {
  const world = { elements: new Float64Array(16) }
  const pages = Array.from(
    { length: ROWS },
    (_, i) =>
      ({
        url: `p${i}`,
        min: [0, 0, 0],
        max: [1, 1, 1],
      }) as unknown as PageRec,
  )
  // One world for every row, the model's root's: its rows are those it moves. The model's pages
  // are packed 0..5 and their rows are the scattered MODEL_ROWS. Its winding is held: a move that
  // keeps it writes no row.
  const model = {
    world,
    pages: MODEL_ROWS.map((row) => pages[row]),
    windingEpoch: 1,
    windingCw: false,
    packedBase: 0,
  }
  const rows = createWebgpuRowState(pages, ROWS)
  rows.pageTableFloats = new Float32Array(ROWS * ROW_WORDS)
  for (let row = 0; row < ROWS; row++) {
    rows.setRowOf(row, row)
    rows.packedPageIndex[row] = row
  }
  MODEL_ROWS.forEach((row, packed) => {
    rows.setRowOf(packed, row)
    rows.packedPageIndex[row] = packed
  })
  rows.packedCount = ROWS
  const cornerHold = createCornerHold()
  cornerHold.count = ROWS
  const forgotten: number[] = []
  const { device, writes } = fakeDevice()
  // Rows each write sent to the page table.
  const table = () => writes.map(({ size }) => size! / PAGE_INFO_STRIDE)
  const rt = {
    layout: {
      rows,
      drawSlots: ROWS,
      cornerHold,
      selectionRoots: [model],
      // Every packed rank names the one placement.
      placement: {
        baseOfRoot: Int32Array.of(0),
        packedCount: ROWS,
      },
    },
    run: { noOccluderHistory: false, movedWorlds: createChangedRuns() },
    blendState: { occlusionEpoch: 1 },
    timing: { encodeCounts: { rowsUploaded: 0 } },
    gpu: { device },
    vis: {
      pageTable: {},
      gpuPartition: {
        forgetRows: (from: number, to: number) => forgotten.push(to - from + 1),
      },
    },
  } as unknown as WebgpuPagesRuntime
  const sum = (counts: number[]) => counts.reduce((a, b) => a + b, 0)
  return { rt, model, forgotten, table, sum }
}

test('a scattered model that only moved forgets no history and sends no row: its world goes up', () => {
  const { rt, model, forgotten, table } = scatteredScene()
  assert.equal(moveRootRows(rt, model, 0), 0, 'its winding kept: no row written')
  assert.equal(rt.layout.rows.dirtyCount, 0)
  assert.deepEqual(rt.rootWorlds?.moved.take(), Int32Array.of(0), 'its world named, once')
  forgetRewrittenRows(rt)
  uploadDirtyRows(rt)
  assert.deepEqual(forgotten, [], 'its rows keep their occlusion history')
  assert.deepEqual(table(), [], 'no row of the table travels')
})

test('a scattered model whose winding turned writes its own rows, run by run', () => {
  const { rt, model, forgotten, table, sum } = scatteredScene()
  model.windingCw = true
  assert.equal(moveRootRows(rt, model, 0), MODEL_ROWS.length)
  assert.equal(model.windingEpoch, undefined, 'its winding is computed again')
  forgetRewrittenRows(rt)
  uploadDirtyRows(rt)
  assert.deepEqual(forgotten, [2, 3, 1], 'three runs, 6 rows of the 995 spanned')
  assert.deepEqual(table(), [2, 3, 1], 'the same 6 rows of the table sent')
  assert.equal(rt.timing.encodeCounts.rowsUploaded, sum(table()))
})

test('pages bounded elsewhere forget and send their own rows, run by run', () => {
  const { rt, model, forgotten, table, sum } = scatteredScene()
  assert.equal(markRootRows(rt, model, 0, MODEL_ROWS.length - 1), MODEL_ROWS.length)
  const { rows } = rt.layout
  // The runs reach the first and last rows of the model.
  const dirty = runsOf(rows.forEachDirtyRun)
  assert.deepEqual([dirty[0][0], dirty.at(-1)![1]], [3, 997])
  forgetRewrittenRows(rt)
  uploadDirtyRows(rt)
  assert.deepEqual(forgotten, [2, 3, 1], 'three runs, 6 rows forgotten of the 995 spanned')
  assert.deepEqual(table(), [2, 3, 1], 'the same 6 rows of the table sent')
  assert.equal(rows.dirtyCount, 0, 'every mark consumed')
  // A still image: nothing marked, nothing forgotten, nothing sent.
  forgetRewrittenRows(rt)
  uploadDirtyRows(rt)
  assert.equal(sum(forgotten), 6)
  assert.equal(sum(table()), 6)
  assert.equal(rt.timing.encodeCounts.rowsUploaded, 0)
})

test('a table that grew forgets the rows that entered', () => {
  const { rt, forgotten } = scatteredScene()
  const { rows, cornerHold } = rt.layout
  cornerHold.count = ROWS - 10
  rows.markRowDirty(5)
  forgetRewrittenRows(rt)
  assert.deepEqual(forgotten, [1, 10], 'the dirty row, then the ten that entered')
  assert.equal(cornerHold.count, ROWS)
})

test('an image without a partition holds no history: the next one forgets every drawable row', () => {
  const { rt, forgotten } = scatteredScene()
  const partition = rt.vis.gpuPartition
  rt.vis.gpuPartition = undefined
  forgetRewrittenRows(rt)
  assert.equal(rt.layout.cornerHold.count, 0)
  rt.vis.gpuPartition = partition
  forgetRewrittenRows(rt)
  assert.deepEqual(forgotten, [ROWS])
})
