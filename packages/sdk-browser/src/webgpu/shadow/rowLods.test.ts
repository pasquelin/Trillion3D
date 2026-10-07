// A moved model writes the detail of its own rows, not of the still rows between them. The
// detail must not follow the table's one dirty span: two models moving at both ends of a table of
// seven thousand rows would recompute and send every row of it, each image.
import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadRowLods } from './rowLods.ts'
import { ROW_LOD_FLOATS, writeRowLod } from './rowLodWords.ts'
import { moveRootRows } from '../pages/render/movedRoot.ts'
import { createWebgpuRowState } from '../row/state.ts'
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import type { PageRec } from '../../page/selection/types.ts'
import { fakeDevice, replayWrites } from '../../../../../tests/kit/gpu/fakeDevice.ts'

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
  const model = {
    world: { elements: identity() },
    worldBox: Float64Array.of(-1, -1, -1, 1, 1, 1),
    localBox: Float64Array.of(-1, -1, -1, 1, 1, 1),
    reach: 0.25,
    pages: pages.slice(0, MODEL_ROWS.length),
    windingEpoch: 1,
    packedBase: 0,
  }
  const terrain = {
    world: { elements: identity() },
    worldBox: Float64Array.of(-9, 0, -9, 9, 1, 9),
    pages,
  }
  const rows = createWebgpuRowState(pages, ROWS)
  rows.pageTableFloats = new Float32Array((ROWS * PAGE_INFO_STRIDE) / 4)
  // Packed ranks 0..5 are the model's, at its scattered rows; the terrain's fill the others.
  const free = Array.from({ length: ROWS }, (_, row) => row).filter(
    (row) => !MODEL_ROWS.includes(row),
  )
  ;[...MODEL_ROWS, ...free].forEach((row, packed) => {
    rows.rowOfPage[packed] = row
    rows.packedPageIndex[row] = packed
    rows.packedRecs[row] = pages[packed]
  })
  rows.packedCount = ROWS
  const ready = new Uint8Array(ROWS).fill(1),
    childReady = new Uint8Array(ROWS).fill(1)
  const { device, writes } = fakeDevice()
  const rt = {
    layout: {
      rows,
      selectionRoots: [model, terrain],
      placement: {
        rootOfPacked: Int32Array.from({ length: ROWS }, (_, p) => (p < MODEL_ROWS.length ? 0 : 1)),
      },
    },
    run: {
      noOccluderHistory: false,
      temporalHizState: {},
      gpuSelection: {
        isReady: (page: number) => ready[page] === 1,
        isChildReady: (page: number) => childReady[page] === 1,
      },
    },
    blendState: { occlusionEpoch: 1 },
    lights: {},
    gpu: { device },
  } as unknown as WebgpuPagesRuntime
  // What the GPU buffer holds, and what a full recompute of every row would hold.
  const gpuBytes = new ArrayBuffer(ROWS * ROW_LOD_FLOATS * 4)
  const everyRow = () => {
    const out = new Float32Array(ROWS * ROW_LOD_FLOATS)
    for (let row = 0; row < ROWS; row++) {
      const page = rows.packedPageIndex[row]
      writeRowLod(
        out,
        row,
        rows.packedRecs[row],
        rt.layout.selectionRoots[rt.layout.placement.rootOfPacked[page]],
        ready[page] === 1,
        childReady[page] === 1,
      )
    }
    return new Uint32Array(out.buffer)
  }
  return { rt, model, writes, gpuBytes, everyRow, ready, device }
}

test('a model scattered across the table writes the detail of its own rows, run by run', () => {
  const { rt, model, writes, gpuBytes, everyRow, ready, device } = scene()
  const { rows } = rt.layout
  uploadRowLods(rt, device)
  assert.deepEqual(
    writes.map(({ size }) => size! / ROW_LOD_FLOATS),
    [ROWS],
    'a new buffer: every row once',
  )
  replayWrites(gpuBytes, writes)
  rows.clearDirty()
  // The model moves and a terrain page's readiness moves (its row marked, as the stream does).
  model.world.elements[12] = 3.5
  model.world.elements[0] = 2
  assert.equal(moveRootRows(rt, model), MODEL_ROWS.length)
  const terrainPage = rows.packedPageIndex[600]
  ready[terrainPage] = 0
  rows.markRowWords(600)
  assert.deepEqual([rows.dirtyFrom, rows.dirtyTo], [3, 997])
  uploadRowLods(rt, device)
  assert.deepEqual(
    writes.map(({ size }) => size! / ROW_LOD_FLOATS),
    [2, 3, 1, 1],
    'four runs: 7 rows of the 995 spanned',
  )
  replayWrites(gpuBytes, writes)
  // Bit for bit what recomputing every row gives, and so what the span's recompute gave.
  assert.deepEqual(new Uint32Array(gpuBytes), everyRow())
  rows.clearDirty()
  // A still image: nothing marked, nothing written.
  uploadRowLods(rt, device)
  assert.equal(writes.length, 0)
})
