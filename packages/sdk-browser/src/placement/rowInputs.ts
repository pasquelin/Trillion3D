/**
 * WHAT THE ROWS PASS DERIVES A ROW'S WORLD-DEPENDENT WORDS FROM, kept for every caster row of the
 * table (`rowWords.ts`). A row's world sphere, its eight Hi-Z corners and its shadow detail are each
 * made of its root's world and of what a world does not change — the page's box and sphere, its
 * errors, its reach, the cut rule's residency —; the second is what a row's inputs hold
 * (`rowInputPack.ts`): twenty-four doubles, written when the row is, read by the GPU whenever the
 * row's root moves. No CPU copy of them is held: a run is packed in a scratch and sent.
 */
import { rootOf, rootOfPacked } from '../page/selection/placements.ts'
import { INPUT_FLAGS, ROW_INPUT_DOUBLES, packInputs, rowInputs } from './rowInputPack.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import { sizedBuffer } from '../gpu/core/sizedBuffer.ts'

/** Words of a row's inputs, packed. */
const ROW_INPUT_WORDS = ROW_INPUT_DOUBLES * 2
/** Rows one write sends at most: the scratch a run is packed in stays this size. */
const RUN_ROWS = 4096

export function createRowInputs() {
  return {
    buffer: undefined as GPUBuffer | undefined,
    /** Caster rows the buffer holds inputs for. */
    rows: 0,
    words: new Uint32Array(0),
    scratch: new Float64Array(ROW_INPUT_DOUBLES),
  }
}
type RowInputs = ReturnType<typeof createRowInputs>

/**
 * The inputs buffer at the table's caster rows (`casterSlots`), made again — at a capacity grown by
 * the one rule (`sizedBuffer`) — when it holds another count: true then, every row's inputs to be
 * sent again, a buffer made anew holding none.
 */
export function ensureRowInputs(held: RowInputs, device: GPUDevice, rows: number) {
  if (held.buffer && held.rows === rows) return false
  const bytes = Math.max(1, rows) * ROW_INPUT_WORDS * 4
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  held.buffer = sizedBuffer(device, held.buffer, bytes, usage, 'Trillion3D row inputs')
  held.rows = rows
  return true
}

/** The inputs of rows `[from, to]` packed as the GPU reads them, from word 0 of `held.words`. */
function packRun(rt: WebgpuPagesRuntime, held: RowInputs, from: number, to: number) {
  const { rows, selectionRoots, placement } = rt.layout,
    selection = rt.run.gpuSelection
  held.words = resized(held.words, (to - from + 1) * ROW_INPUT_WORDS)
  for (let row = from; row <= to; row++) {
    const rec = rows.packedRecs[row],
      page = rows.packedPageIndex[row]
    const root = rec && rootOf(selectionRoots, rootOfPacked(placement, page))
    rowInputs(
      held.scratch,
      0,
      rec,
      root,
      (rec && selection?.isReady(page)) ?? true,
      (rec && selection?.isChildReady(page)) ?? true,
      row < rows.blendFirst,
    )
    packInputs(held.words, (row - from) * ROW_INPUT_WORDS, held.scratch)
  }
}

/** Row `row`'s inputs' bits sent alone, one double: its cut readiness moved, nothing else of it. */
export function sendRowFlags(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  held: RowInputs,
  row: number,
) {
  packRun(rt, held, row, row)
  const flags = INPUT_FLAGS * 2
  device.queue.writeBuffer(held.buffer!, (row * ROW_INPUT_WORDS + flags) * 4, held.words, flags, 2)
}

/** The inputs of rows `[from, to]` of the table sent, a write each `RUN_ROWS` rows. */
export function sendRowInputs(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  held: RowInputs,
  from: number,
  to: number,
) {
  for (let first = from; first <= to; first += RUN_ROWS) {
    const last = Math.min(to, first + RUN_ROWS - 1)
    packRun(rt, held, first, last)
    device.queue.writeBuffer(
      held.buffer!,
      first * ROW_INPUT_WORDS * 4,
      held.words,
      0,
      (last - first + 1) * ROW_INPUT_WORDS,
    )
  }
}
