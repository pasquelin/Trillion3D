/**
 * THE ROWS PASS'S WORK, FOLLOWED ON THE CPU. Every word of a row its root's world decides — its
 * world words, its sphere, its shadow detail — has one writer, the rows pass
 * (`rowWordsPass.ts`), for every row: one written, one whose root the host moved, one a parent
 * composes. The CPU writes what a world does not change: a written row's inputs (`rowInputs.ts`),
 * and a moved root's world, 128 bytes (`../roots/rootWorlds.ts`). Here, once a frame before the rows go up
 * (`followRows`), the rows the pass derives are named: the rows the table declared dirty, and the
 * rows of each root whose world moved, found by its pages — the work follows what moved, never the
 * table. A frame the pass does not run keeps them for the next. Every row derived appends its shadow
 * change (`rowCastWgsl.ts`): a root that moved, or whose casting or mobility changed where it
 * stands (`deriveRootRows`), and a row the table rewrote alike — its former page stales the pages it
 * was drawn into at the pose it was drawn at —; a row named twice is named once.
 */
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { RowRunVisitor } from '../../geometry/rows/dirty.ts'
import { createRowInputs, ensureRowInputs, sendRowFlags, sendRowInputs } from './rowInputs.ts'
import { sendRootWorlds } from '../roots/rootWorlds.ts'
import { takeMoved } from '../roots/rootMoves.ts'
import { rootRows } from '../compose/composedRows.ts'
import { commitRowMotion } from '../../lighting/shadows/casters/rowTravel.ts'
import type { RowWordsGpu } from './rowWordsGpu.ts'
import { ROW_STALES } from './rowWordsWgsl.ts'
import { deriveEveryRow, target } from './rowTargets.ts'
import { createChangedRuns } from '../../geometry/residency/ranges.ts'

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
    /** The rows named since the last pass, the first `count` of `targets` (`ROW_NAMED`, with
     *  `ROW_STALES` when its shadow changed where it stands), `stales` of them so marked; each
     *  row's place among them plus one (`at`), 0 for a row not named (`rowTargets.ts`). */
    targets: new Uint32Array(64),
    count: 0,
    stales: 0,
    at: new Int32Array(0),
    /** The rows the last pass staled, the first `staledCount`: named again should its command
     *  buffer be dropped (`rowWordsDropped`). */
    staled: new Uint32Array(0),
    staledCount: 0,
    /** The roots whose rows the next follow names (`deriveRootRows`), each once. */
    roots: createChangedRuns(),
    /** The pass's GPU side (`rowWordsPass.ts`), made at its first run. */
    gpu: undefined as RowWordsGpu | undefined,
    /** Rows named this frame for another reason than a root's move: written, made ready, every
     *  row — what the shadow chunks' bound counts as changed (`commitRowMotion`). */
    derived: 0,
  }
}
export type RowWords = ReturnType<typeof createRowWords>

/** The runtime's rows pass work, made at its first follow. */
const rowWordsOf = (rt: Pick<WebgpuPagesRuntime, 'rowWords'>) => (rt.rowWords ??= createRowWords())

/** Row `row`'s shadow changed where it stands — a cutout's colour tile came or went, its surface's
 *  alpha moved —: the box of the sphere the rows pass holds for it, the one its shadow pages were
 *  drawn from, appended at the next pass before the row is derived (`ROW_STALES`, `staleRow`). */
export const nameCastRow = (rt: Pick<WebgpuPagesRuntime, 'rowWords'>, row: number) =>
  target(rowWordsOf(rt), row, ROW_STALES)

/** Root `rank`'s rows derived at the next pass: it moved — a node's move, a row posed past what its
 *  shadows hold, a parent let go —, or its casting or its mobility changed where it stands
 *  (`flipWorld`, `../../lighting/shadows/casters/mobility.ts`'s settle), which no world sent says. */
export const deriveRootRows = (rt: Pick<WebgpuPagesRuntime, 'rowWords'>, rank: number) =>
  rowWordsOf(rt).roots.mark(rank)

/** A run of rows the table declared dirty: their inputs sent and their words derived again. */
const dirtyRun: RowRunVisitor<WebgpuPagesRuntime> = (rt, from, to) => {
  const state = rt.rowWords!
  if (!state.sentWhole) sendRowInputs(rt, rt.gpu.device!, state.inputs, from, to)
  for (let row = from; row <= to; row++) target(state, row)
  state.derived += to - from + 1
}

/** The rows of root `rank`'s resident pages derived again (`rootRows`). */
const targetRootRows = (rt: WebgpuPagesRuntime, state: RowWords, rank: number) =>
  rootRows(rt, rank, (row) => target(state, row))

/**
 * Brings the rows pass's inputs and its rows level with the table and the worlds, before the rows
 * go up (`uploadDirtyRows`, which clears the marks this reads): the moved roots' worlds sent, the
 * dirty rows' inputs sent, and both named. A table of another size, or a world table sent whole,
 * has every row's inputs sent and every row derived; a pass whose command buffer was dropped, every
 * row derived (`all`).
 */
export function followRowWords(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { rows } = rt.layout,
    state = rowWordsOf(rt)
  if (!rows.pageTableInts) return
  const fresh = ensureRowInputs(state.inputs, device, rows.casterSlots)
  sendRootWorlds(rt, device)
  const moved = takeMoved(rt.rootWorlds!.rows)
  state.sentWhole = fresh || !moved
  if (state.sentWhole) {
    deriveEveryRow(state)
    if (rows.casterSlots) sendRowInputs(rt, device, state.inputs, 0, rows.casterSlots - 1)
    state.derived += rows.casterSlots
  }
  rows.forEachDirtyRun(rt, dirtyRun, rows.casterSlots - 1)
  // A row whose readiness moved: its detail's bits go up, eight bytes, and its words are derived.
  const ready = rows.takeReadyRows()
  for (let k = 0; k < ready.length && ready[k] < rows.casterSlots; k++) {
    if (!state.sentWhole) sendRowFlags(rt, device, state.inputs, ready[k])
    target(state, ready[k])
    state.derived++
  }
  // A root both lists name is walked once, by the asked list. Both lists increase: one walk skips
  // the moved roots the asked list holds.
  const asked = state.roots.take()
  if (moved)
    for (let k = 0, j = 0; k < moved.length; k++) {
      while (j < asked.length && asked[j] < moved[k]) j++
      if (asked[j] !== moved[k]) targetRootRows(rt, state, moved[k])
    }
  for (const rank of asked) targetRootRows(rt, state, rank)
  // The rows a moving root's travel carries are counted by how far it went, the others whole.
  commitRowMotion(rt, state.derived)
  state.derived = 0
}
