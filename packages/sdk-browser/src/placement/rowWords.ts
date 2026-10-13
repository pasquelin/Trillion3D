/**
 * THE ROWS PASS'S WORK, FOLLOWED ON THE CPU. Every word of a row its root's world decides — its
 * world words, its sphere, its Hi-Z corners, its shadow detail — has one writer, the rows pass
 * (`rowWordsPass.ts`), for every row: one written, one whose root the host moved, one a parent
 * composes. The CPU writes what a world does not change: a written row's inputs (`rowInputs.ts`),
 * and a moved root's world, 128 bytes (`rootWorlds.ts`). Here, once a frame before the rows go up
 * (`followRows`), the rows the pass derives are named: the rows the table declared dirty, and the
 * rows of each root whose world moved, found by its pages — the work follows what moved, never the
 * table. A frame the pass does not run keeps them for the next.
 */
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { RowRunVisitor } from '../webgpu/row/dirty.ts'
import { createRowInputs, ensureRowInputs, sendRowFlags, sendRowInputs } from './rowInputs.ts'
import { sendRootWorlds } from './rootWorlds.ts'
import { takeMovedRows } from './rootMoves.ts'
import { followComposedRun } from './composedRows.ts'
import { closeSphereCopies, copyClusterSpheres } from '../webgpu/shadow/spheres.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import type { RowWordsGpu } from './rowWordsGpu.ts'

function createRowWords() {
  return {
    inputs: createRowInputs(),
    /** Every caster row is derived at the next pass: a table, a part or a world table made anew,
     *  or a command buffer holding the pass dropped (`encodedInto`). */
    all: true,
    /** Every row's inputs were sent by this frame's follow: a dirty run sends none again. */
    sentWhole: false,
    /** The command encoder the last pass was encoded into. */
    encodedInto: undefined as GPUCommandEncoder | undefined,
    /** The rows named since the last pass, the first `count` of `targets`. */
    targets: new Uint32Array(64),
    count: 0,
    /** The pass's GPU side (`rowWordsPass.ts`), made at its first run. */
    gpu: undefined as RowWordsGpu | undefined,
  }
}
export type RowWords = ReturnType<typeof createRowWords>

/** The runtime's rows pass work, made at its first follow. */
const rowWordsOf = (rt: Pick<WebgpuPagesRuntime, 'rowWords'>) => (rt.rowWords ??= createRowWords())

/** Row `row` derived at the next pass. */
function target(state: RowWords, row: number) {
  if (state.all) return
  state.targets = resized(state.targets, state.count + 1)
  state.targets[state.count++] = row
}

/** A run of rows the table declared dirty: their inputs sent and their words derived again, the
 *  composed rows' list and the spheres' CPU copy following them. */
const dirtyRun: RowRunVisitor<WebgpuPagesRuntime> = (rt, from, to) => {
  const state = rt.rowWords!
  if (!state.sentWhole) sendRowInputs(rt, rt.gpu.device!, state.inputs, from, to)
  for (let row = from; row <= to; row++) target(state, row)
  followComposedRun(rt, from, to)
  copyClusterSpheres(rt, from, to)
}

/** The rows of root `rank`'s resident pages derived again: its world moved. A row the cache gave
 *  back may name another page since: only a row that is this page's. */
function targetRootRows(rt: WebgpuPagesRuntime, state: RowWords, rank: number) {
  const { rows, selectionRoots } = rt.layout,
    root = selectionRoots[rank],
    base = root?.packedBase ?? -1
  if (!root || base < 0) return
  for (let page = 0; page < root.pages.length; page++) {
    const index = base + page,
      transparent = !!root.pages[page].transparent
    // A blended cluster moves its caster row (`../webgpu/row/blendCasters.ts`), which is its own.
    const row = transparent ? rows.blendRowOf(index) : rows.rowOf(index)
    if (row < 0 || row >= rows.casterSlots) continue
    if (!transparent && (row >= rows.packedCount || rows.packedPageIndex[row] !== index)) continue
    target(state, row)
    copyClusterSpheres(rt, row, row)
  }
}

/**
 * Brings the rows pass's inputs and its rows level with the table and the worlds, before the rows
 * go up (`uploadDirtyRows`, which clears the marks this reads): the moved roots' worlds sent, the
 * dirty rows' inputs sent, and both named. A table of another size, or a world table sent whole,
 * has every row's inputs sent and every row derived; a pass whose command buffer was dropped, every
 * row derived (`all`). A frame no parent composes stops the composed
 * rows' list, made again whole at the next link.
 */
export function followRowWords(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { rows } = rt.layout,
    compose = rt.compose,
    state = rowWordsOf(rt)
  if (!rows.pageTableInts) return
  if (compose && !compose.parentIds.size) compose.rowsFollowed = false
  const fresh = ensureRowInputs(state.inputs, device, rows.casterSlots)
  if (fresh && compose) compose.rowsFollowed = false
  sendRootWorlds(rt, device)
  const moved = takeMovedRows(rt.rootWorlds!)
  state.sentWhole = fresh || !moved
  if (state.sentWhole) {
    state.all = true
    state.count = 0
    if (rows.casterSlots) {
      sendRowInputs(rt, device, state.inputs, 0, rows.casterSlots - 1)
      copyClusterSpheres(rt, 0, rows.casterSlots - 1)
    }
  }
  rows.forEachDirtyRun(rt, dirtyRun, rows.casterSlots - 1)
  // A row whose readiness moved: its detail's bits go up, eight bytes, and its words are derived.
  const ready = rows.takeReadyRows()
  for (let k = 0; k < ready.length && ready[k] < rows.casterSlots; k++) {
    if (!state.sentWhole) sendRowFlags(rt, device, state.inputs, ready[k])
    target(state, ready[k])
  }
  if (moved) for (let k = 0; k < moved.length; k++) targetRootRows(rt, state, moved[k])
  closeSphereCopies(rt)
}
