/**
 * THE ROWS OF THE ROOTS A PARENT COMPOSES, listed densely for the rows pass (`rowWords.ts`): a
 * parent that moves moves every row of its roots, and the pass derives them again from the worlds
 * the compose worlds pass wrote, a thread a row of a composed root, never a thread a row of the
 * table. The list is followed where the table changes — the rows each frame's dirty marks name,
 * the rows of a root linked or unlinked — and listed again whole only when it starts following a
 * table (`MirroredKeys`). A parent's move costs the CPU nothing a row.
 */
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import {
  mirroredWords,
  mirrorKey,
  takeMirrored,
  type MirroredKeys,
} from '../webgpu/cut/denseKeys.ts'
import { sizedBuffer } from '../gpu/core/sizedBuffer.ts'
import { writeBufferRuns } from './rootListPass.ts'
import { ROW_WORDS } from '../visibility/types.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import type { ComposeState } from './gpuComposeState.ts'
import { PAGE_INFO } from '../visibility/pageInfo.ts'

/**
 * `list` in `held` on the GPU, the buffer returned: one made again — the list sent whole — when the
 * list outgrows it, at a capacity grown by the one rule (`sizedBuffer`); else the places written
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
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    buffer = sizedBuffer(device, held, Math.max(4, count) * 4, usage, label)
  if (buffer !== held) {
    moves.clear()
    if (count) device.queue.writeBuffer(buffer, 0, set.list, 0, count)
    return buffer
  }
  if (!moves.count) return buffer
  const moved = takeMirrored(list)
  if (moved.length) writeBufferRuns(device, buffer, moved, moved.length, mirroredWords(list), 1)
  return buffer
}

/** Whether `row` is a caster row the table holds: a drawn row, or a blended caster's. */
const casterRow = (rows: WebgpuPagesRuntime['layout']['rows'], row: number) =>
  row < rows.rowCount || (row >= rows.blendFirst && row < rows.casterSlots)

/** Row `row` in the rows list or out of it: in while the root the table names it by is composed. */
function followRow(state: ComposeState, rows: WebgpuPagesRuntime['layout']['rows'], row: number) {
  const ints = rows.pageTableInts!,
    rank = casterRow(rows, row) ? ints[row * ROW_WORDS + PAGE_INFO.at.placement] : NO_INDEX
  mirrorKey(state.rowList, row, rank < state.roots && state.parentOf[rank] !== NO_INDEX)
}

/** Rows `[from, to]` of the table followed into the rows list, while it follows the table. */
export function followComposedRun(rt: WebgpuPagesRuntime, from: number, to: number) {
  const state = rt.compose,
    { rows } = rt.layout
  if (!state?.parentIds.size || !rows.pageTableInts || !state.rowsFollowed) return
  for (let row = from; row <= to; row++) followRow(state, rows, row)
}

/**
 * The rows list, as the rows pass reads it: every caster row of the table listed again from the
 * words it holds once the list starts following it (`rowsFollowed`) — at the first link, after a
 * frame no parent composed —, then the rows of each root linked or unlinked since, found by its
 * pages (`rowOf`), O(its pages).
 */
export function followComposedRows(rt: WebgpuPagesRuntime, state: ComposeState) {
  const { rows, selectionRoots } = rt.layout
  if (!rows.pageTableInts) return
  if (!state.rowsFollowed) {
    state.rowList.set.clear()
    state.rowList.moves.clear()
    state.relinked.length = 0
    state.rowsFollowed = true
    for (let row = 0; row < rows.rowCount; row++) followRow(state, rows, row)
    for (let row = rows.blendFirst; row < rows.casterSlots; row++) followRow(state, rows, row)
    return
  }
  for (const rank of state.relinked) {
    const root = selectionRoots[rank],
      base = root?.packedBase ?? -1
    if (!root || base < 0) continue
    for (let page = 0; page < root.pages.length; page++) {
      const index = base + page,
        row = root.pages[page].transparent ? rows.blendRowOf(index) : rows.rowOf(index)
      if (row >= 0) followRow(state, rows, row)
    }
  }
  state.relinked.length = 0
}
