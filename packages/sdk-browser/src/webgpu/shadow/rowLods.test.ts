// A moved model has the rows pass derive the detail of its own rows, not of the still rows between
// them, and the CPU sends its world alone: no word of its rows. The detail must not follow the
// table's one dirty span, nor be computed on the CPU: two models moving at both ends of a table of
// seven thousand rows would recompute and send every row of it, each image. The words the pass
// writes — the shipped WGSL, which the fake device runs — are the CPU oracle's, bit for bit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureRowLods } from './rowLods.ts'
import { ROW_LOD_FLOATS } from './rowLodWords.ts'
import { writeRowLod } from './rowLodWords.fixture.ts'
import { moveRootRows } from '../pages/render/movedRoot.ts'
import { createChangedRuns } from '../residency/ranges.ts'
import { createWebgpuRowState } from '../row/state.ts'
import { PAGE_INFO_STRIDE, ROW_WORDS } from '../../visibility/types.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import type { PageRec } from '../../page/selection/types.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { rootOfPacked } from '../../page/selection/placements.ts'
import { followRowWords } from '../../placement/rowWords.ts'
import { encodeRowWords } from '../../placement/rowWordsPass.ts'
import { uploadDirtyRows } from '../pages/render/dirtyRows.ts'

const ROWS = 1000,
  MODEL_ROWS = [3, 4, 400, 401, 402, 997]

const identity = () => Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)

/** A table of `ROWS` rows: a model's six pages scattered in it, a still terrain in the others. */
function scene() {
  const pages = Array.from(
    { length: ROWS },
    (_, i) =>
      ({
        url: `p${i}`,
        min: [0, 0, 0],
        max: [1, 1, 1],
        sphere: [i * 0.5, 1, -i, 2],
        lodError: 0.01 * (i % 7),
        level: i % 3,
        parentError: i % 5 ? 0.1 * (i % 5) : undefined,
        parentSphere: [i * 0.5, 2, -i, 4],
      }) as unknown as PageRec,
  )
  // The model's winding is held: a move that keeps it writes no row.
  const model = {
    world: { elements: identity() },
    worldBox: Float64Array.of(-1, -1, -1, 1, 1, 1),
    localBox: Float64Array.of(-1, -1, -1, 1, 1, 1),
    reach: 0.25,
    pages: pages.slice(0, MODEL_ROWS.length),
    windingEpoch: 1,
    windingCw: false,
    packedBase: 0,
  }
  const terrain = {
    world: { elements: identity() },
    worldBox: Float64Array.of(-9, 0, -9, 9, 1, 9),
    pages,
  }
  const rows = createWebgpuRowState(pages, ROWS)
  rows.pageTableFloats = new Float32Array(ROWS * ROW_WORDS)
  rows.pageTableInts = new Uint32Array(rows.pageTableFloats.buffer)
  const placement = { baseOfRoot: Int32Array.of(0, MODEL_ROWS.length), packedCount: ROWS }
  // Packed ranks 0..5 are the model's, at its scattered rows; the terrain's fill the others.
  const free = Array.from({ length: ROWS }, (_, row) => row).filter(
    (row) => !MODEL_ROWS.includes(row),
  )
  ;[...MODEL_ROWS, ...free].forEach((row, packed) => {
    rows.setRowOf(packed, row)
    rows.packedPageIndex[row] = packed
    rows.packedRecs[row] = pages[packed]
    rows.pageTableInts![row * ROW_WORDS + PAGE_INFO.at.placement] = rootOfPacked(placement, packed)
  })
  rows.packedCount = rows.rowCount = ROWS
  rows.markRowDirty(0, ROWS - 1)
  const ready = new Uint8Array(ROWS).fill(1),
    childReady = new Uint8Array(ROWS).fill(1)
  const { device, writes } = fakeDevice()
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const rt = {
    layout: { rows, selectionRoots: [model, terrain], placement },
    run: {
      noOccluderHistory: false,
      movedWorlds: createChangedRuns(),
      gpuComputeDispatches: 0,
      gpuSelection: {
        isReady: (page: number) => ready[page] === 1,
        isChildReady: (page: number) => childReady[page] === 1,
        // The roots' frame words, where the root boxes pass writes their stretch.
        worldRanges: [{ first: 0, count: 2, frames: device.createBuffer({ size: 256, usage }) }],
      },
    },
    blendState: { occlusionEpoch: 1 },
    lights: {},
    timing: { encodeCounts: { rowsUploaded: 0 } },
    vis: { pageTable: device.createBuffer({ size: ROWS * PAGE_INFO_STRIDE, usage }) },
    gpu: { device },
  } as unknown as WebgpuPagesRuntime
  ensureRowLods(rt, device)
  // What the detail buffer holds, and what the CPU oracle gives for every row.
  const held = () =>
    new Uint32Array((rt.lights.rowLods!.buffer as unknown as { data: Uint8Array }).data.buffer)
  const everyRow = () => {
    const out = new Float32Array(ROWS * ROW_LOD_FLOATS)
    for (let row = 0; row < ROWS; row++) {
      const page = rows.packedPageIndex[row]
      writeRowLod(
        out,
        row,
        rows.packedRecs[row],
        rt.layout.selectionRoots[rootOfPacked(placement, page)],
        ready[page] === 1,
        childReady[page] === 1,
      )
    }
    return new Uint32Array(out.buffer)
  }
  /** One image's rows: followed, sent, then derived by the pass. */
  const frame = () => {
    followRowWords(rt, device)
    const named = [...rt.rowWords!.targets.subarray(0, rt.rowWords!.count)]
    uploadDirtyRows(rt)
    encodeRowWords(rt, device, device.createCommandEncoder())
    return named
  }
  return { rt, model, writes, held, everyRow, ready, frame }
}

/** The labels of the buffers `writes` went to, in order. */
const labels = (writes: { buffer: unknown }[]) =>
  writes.map(({ buffer }) => (buffer as { label?: string }).label)

test('a model scattered across the table has the rows pass derive its own rows, run by run', () => {
  const { rt, model, writes, held, everyRow, ready, frame } = scene()
  const { rows } = rt.layout
  assert.deepEqual(frame(), [], 'a new table: every row derived, none named')
  assert.deepEqual(held(), everyRow(), 'every row once, the oracle’s words')
  // The model moves and a terrain page's readiness moves (its row marked, as the stream does).
  writes.length = 0
  model.world.elements[12] = 3.5
  model.world.elements[0] = 2
  assert.equal(moveRootRows(rt, model, 0), 0, 'no row of the moved model written')
  ready[rows.packedPageIndex[600]] = 0
  rows.markRowOfPage(rows.packedPageIndex[600])
  assert.deepEqual(frame(), [600, ...MODEL_ROWS], 'seven rows of the 995 spanned')
  // The CPU sent the model's world, then the bits of the row whose readiness moved: one double, no
  // row of the table, and no box — the GPU carries the model's by its world.
  assert.deepEqual(labels(writes).slice(0, 2), ['Trillion3D root worlds', 'Trillion3D row inputs'])
  assert.deepEqual([writes[0].size, writes[1].size], [32, 2])
  assert.equal(labels(writes).includes('Trillion3D root world boxes'), false, 'no CPU box')
  assert.equal(labels(writes).includes(undefined), false, 'no table row sent')
  // Bit for bit what the oracle gives for every row, the model at its new world.
  assert.deepEqual(held(), everyRow())
  // A still image: nothing named, nothing written, no pass.
  writes.length = 0
  const dispatches = rt.run.gpuComputeDispatches
  assert.deepEqual(frame(), [])
  assert.equal(writes.length, 0)
  assert.equal(rt.run.gpuComputeDispatches, dispatches)
})
