/**
 * WHAT THE COMPOSE ROWS PASS DERIVES A ROW'S WORLD-DEPENDENT WORDS FROM, AND THE ROWS IT RUNS OVER,
 * kept beside the rows (`gpuCompose.ts`). A parent that moves a root moves every word a row derives
 * from its world: the world sphere the shadow cull drops it by, the eight corners the Hi-Z test
 * projects, the detail the shadows' levels are judged by. Each is made of the root's world and of
 * what the world does not change — the page's box and sphere, its errors, its reach, the cut rule's
 * residency —, and the second is what a row's inputs hold: twenty-four doubles, written when the
 * row is, read by the GPU every frame a parent moves its root. The CPU writes each of those words
 * from the same inputs when it writes the row (`writeClusterSphere`, `packPageCorners`,
 * `writeRowLod`); the GPU's are the same words (`gpuComposeDerivedWgsl.ts`).
 *
 * The rows pass runs a thread a row of a composed root, never a thread a row of the table: the
 * rows whose root, as the table names it, a parent composes are listed densely,
 * followed where the table changes — the rows each frame's dirty marks name, the rows of a root
 * linked or unlinked — and listed again whole only when the list starts following a table
 * (`MirroredKeys`).
 */
import { rootOf, rootOfPacked } from '../page/selection/placements.ts'
import { ROW_INPUT_DOUBLES, packInputs, rowInputs } from './composedRowPack.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import {
  mirroredWords,
  mirrorKey,
  takeMirrored,
  type MirroredKeys,
} from '../webgpu/cut/denseKeys.ts'
import { grownLength, resized } from '../../../math/src/sequence/resized.ts'
import { writeRanges } from '../gpu/dag/split.ts'
import { ROW_WORDS } from '../visibility/types.ts'
import { ROW_PLACEMENT_WORD } from '../webgpu/row/rowPlacement.ts'
import { NONE } from './gpuComposeWgsl.ts'
import type { ComposeState } from './gpuCompose.ts'

/** Words of a row's inputs, packed. */
const ROW_INPUT_WORDS = ROW_INPUT_DOUBLES * 2

/**
 * `list` in `held` on the GPU, the buffer returned: one made again — the list sent whole — when the
 * list outgrows it, at a capacity grown by the one rule (`grownLength`); else the places written
 * since sent in the cut's one run writer's runs. Nothing when none was.
 */
export function sendList(
  device: GPUDevice,
  held: GPUBuffer | undefined,
  label: string,
  list: MirroredKeys,
) {
  const { set, moves } = list,
    count = set.count
  if (!held || held.size < count * 4) {
    const capacity = grownLength(held ? held.size / 4 : 0, Math.max(4, count))
    held?.destroy()
    const buffer = device.createBuffer({
      label,
      size: capacity * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    moves.listed.clear()
    if (count) device.queue.writeBuffer(buffer, 0, set.list, 0, count)
    return buffer
  }
  if (!moves.listed.count) return held
  const moved = takeMirrored(list)
  const into = (offset: number, data: ArrayBuffer, from: number, size: number) =>
    device.queue.writeBuffer(held, offset, data, from, size)
  if (moved.length)
    writeRanges(device, into, moved, moved.length, {
      data: mirroredWords(list),
      sourceBase: 0,
      targetBase: 0,
      stride: 1,
    })
  return held
}

/** Row `row` in the rows list or out of it: in while the root the table names it by is composed. */
function followRow(state: ComposeState, ints: Uint32Array, rowCount: number, row: number) {
  const rank = row < rowCount ? ints[row * ROW_WORDS + ROW_PLACEMENT_WORD] : NONE
  mirrorKey(state.rowList, row, rank < state.roots && state.parentOf[rank] !== NONE)
}

/** Rows `[from, to]` of the table followed into the rows list. */
function followRun(rt: WebgpuPagesRuntime, from: number, to: number) {
  const state = rt.compose!,
    { pageTableInts, rowCount } = rt.layout.rows
  if (!pageTableInts || !state.rowsFollowed) return
  for (let row = from; row <= to; row++) followRow(state, pageTableInts, rowCount, row)
}

/**
 * The rows list, as the rows pass reads it: every row of the table listed again from the words it
 * holds once the list starts following it (`rowsFollowed`) — at the first link, after a frame no
 * parent composed, when the table shrank —, then the rows of each root linked or unlinked since,
 * found by its pages (`rowOf`), O(its pages).
 */
export function followComposedRows(rt: WebgpuPagesRuntime, state: ComposeState) {
  const { rows, selectionRoots } = rt.layout,
    ints = rows.pageTableInts
  if (!state.rowsFollowed) {
    state.rowList.set.clear()
    state.rowList.moves.listed.clear()
    state.relinked.length = 0
    state.rowsFollowed = true
    if (ints)
      for (let row = 0; row < rows.rowCount; row++) followRow(state, ints, rows.rowCount, row)
    return
  }
  if (!state.relinked.length) return
  for (const rank of state.relinked) {
    const root = selectionRoots[rank],
      base = root?.packedBase ?? -1
    if (!ints || !root || base < 0) continue
    for (let page = 0; page < root.pages.length; page++) {
      const index = base + page,
        row = root.pages[page].transparent ? rows.blendRowOf(index) : rows.rowOf(index)
      if (row >= 0) followRow(state, ints, rows.rowCount, row)
    }
  }
  state.relinked.length = 0
}

/** The inputs of rows `[from, to]` of the table, packed as the GPU reads them: each double two
 *  words, but the detail's bits one word, which the shader reads as an integer. */
function packRowInputs(
  rt: WebgpuPagesRuntime,
  out: Uint32Array,
  scratch: Float64Array,
  from: number,
  to: number,
) {
  const { rows, selectionRoots, placement } = rt.layout,
    selection = rt.run.gpuSelection
  for (let row = from; row <= to; row++) {
    const rec = rows.packedRecs[row],
      page = rows.packedPageIndex[row],
      base = row * ROW_INPUT_WORDS
    const root = rec && rootOf(selectionRoots, rootOfPacked(placement, page))
    rowInputs(
      scratch,
      0,
      rec,
      root,
      (rec && selection?.isReady(page)) ?? true,
      (rec && selection?.isChildReady(page)) ?? true,
      row < rows.blendFirst,
    )
    packInputs(out, base, scratch)
  }
}

/**
 * The inputs of the table, kept once a parent composes rows: a capacity, grown by the one rule
 * (`resized`), the rows held kept where they are — a table that grows packs and sends its new rows
 * alone —, then the rows each frame's dirty marks name (`uploadComposedRowInputs`). Undefined while
 * no parent composes.
 */
export function composedRowInputs(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const state = rt.compose
  if (!state?.parentIds.size) return undefined
  const rows = rt.layout.rows.rowCount,
    held = state.inputs
  if (held?.rows === rows) return held
  const kept = held ? Math.min(held.rows, rows) : 0
  // A table that shrank lists its rows again whole; one that grew follows its new rows.
  if (held && rows < held.rows) state.rowsFollowed = false
  const packed = resized(held?.packed ?? new Uint32Array(0), Math.max(1, rows) * ROW_INPUT_WORDS)
  let buffer = held?.buffer
  if (!buffer || buffer.size < packed.byteLength) {
    buffer?.destroy()
    buffer = device.createBuffer({
      label: 'Trillion3D composed row inputs',
      size: packed.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    if (kept) device.queue.writeBuffer(buffer, 0, packed, 0, kept * ROW_INPUT_WORDS)
  }
  state.inputs = {
    buffer,
    packed,
    rows,
    scratch: held?.scratch ?? new Float64Array(ROW_INPUT_DOUBLES),
  }
  state.rowsWritten = true
  if (rows > kept) {
    sendRun(rt, device, kept, rows - 1)
    followRun(rt, kept, rows - 1)
  }
  return state.inputs
}

function sendRun(rt: WebgpuPagesRuntime, device: GPUDevice, from: number, to: number) {
  const inputs = rt.compose!.inputs!
  packRowInputs(rt, inputs.packed, inputs.scratch, from, to)
  device.queue.writeBuffer(
    inputs.buffer,
    from * ROW_INPUT_WORDS * 4,
    inputs.packed,
    from * ROW_INPUT_WORDS,
    (to - from + 1) * ROW_INPUT_WORDS,
  )
}

/** The rows the table declared dirty, run by run, in the window of the image in which they are
 *  written (`followRows`) — a row written, a page that arrived or left, a readiness that moved —:
 *  their inputs sent, the rows list following them, and the rows pass told a row was written. A
 *  frame no parent composes follows none: the list is made again whole at the next link. */
export function uploadComposedRowInputs(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const state = rt.compose
  if (!state) return
  if (!state.parentIds.size) {
    state.rowsFollowed = false
    return
  }
  const inputs = composedRowInputs(rt, device)!
  if (rt.layout.rows.dirtyCount) state.rowsWritten = true
  rt.layout.rows.forEachDirtyRun(
    rt,
    (_, from, to) => {
      sendRun(rt, device, from, to)
      followRun(rt, from, to)
    },
    inputs.rows - 1,
  )
}
