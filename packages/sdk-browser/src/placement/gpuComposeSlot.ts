/**
 * A PARENT'S MOVE FOLLOWED (`gpuCompose.ts`): its world held, its rows' draw bins made again when
 * its winding turned, the tree groups and the impostor cards of its roots told, its move told to
 * the shadow mobility.
 */
import { MATRIX_VALUES } from '../../../math/src/batch/strides.ts'
import { matrixWindingCw } from '../../../math/src/matrix/orientation.ts'
import { sameElements } from '../../../math/src/matrix/matrixElements.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { moveRootRows } from '../webgpu/pages/render/movedRoot.ts'
import { slotRanks, type ComposeState } from './gpuComposeState.ts'

/** The draw bins of the rows of `slot`'s roots are made again, from the world the GPU composes,
 *  when its winding turned: a mirror changes which face each row's bin culls (`pipelineFor.ts`).
 *  The rows are written as a row moved is (`moveRootRows`), once a turn, never a move. */
function remakeBins(rt: WebgpuPagesRuntime, state: ComposeState, slot: number) {
  const cw = matrixWindingCw(
    state.worlds.subarray(slot * MATRIX_VALUES, slot * MATRIX_VALUES + MATRIX_VALUES),
  )
  const was = state.winding[slot]
  state.winding[slot] = cw
  if (was === undefined || was === cw) return
  for (const rank of slotRanks(state, slot)) moveRootRows(rt, rt.layout.selectionRoots[rank], rank)
}

/** The groups of the placement tree `slot`'s roots stand in fit again before the next cut: their
 *  leaves moved with the parent. One name a group, never one a root; the list is made once, as the
 *  slot's roots change or a cut is made over the tree again. */
function moveGroups(rt: WebgpuPagesRuntime, state: ComposeState, slot: number) {
  const selection = rt.run.gpuSelection
  if (!selection) return
  if (state.groups?.cut.deref() !== selection)
    state.groups = { cut: new WeakRef(selection), bySlot: new Map() }
  let groups = state.groups.bySlot.get(slot)
  if (!groups) {
    const named = new Set<number>()
    for (const rank of slotRanks(state, slot)) named.add(selection.groupOf(rank))
    named.delete(-1)
    state.groups.bySlot.set(slot, (groups = Int32Array.from(named)))
  }
  selection.groupsMoved(groups)
}

/** The parent's world at `slot`, held, the slot's version drawn anew when it or a link moved; its
 *  move told to the shadow mobility — the rows pass stales the pages its roots' rows left and
 *  entered (`rowCastWgsl.ts`) — and the temporal pyramid. */
export function settleSlot(
  rt: WebgpuPagesRuntime,
  state: ComposeState,
  {
    slot,
    p,
    world,
    relinked,
  }: {
    slot: number
    p: number | undefined
    world: ArrayLike<number>
    relinked: boolean
  },
) {
  // Whether the parent moved: one linked now, or sent at the world it held, did not.
  const moved = p !== undefined && !sameElements(state.worlds, world, slot * MATRIX_VALUES)
  // A parent's move moves its roots: its first makes them moving casters, each how far it went
  // (`mobility.moveLead`), from the world it held.
  if (moved)
    rt.lights.mobility.moveLead(
      slot,
      state.ranksOf[slot],
      state.worlds.subarray(slot * MATRIX_VALUES, slot * MATRIX_VALUES + MATRIX_VALUES),
      world,
    )
  if (moved || p === undefined) state.parentsMoved.mark(slot)
  state.worlds.set(world, slot * MATRIX_VALUES)
  // The slot's composition moves only with its world or a link: a still parent sent again, and
  // every other slot, keep their composed worlds and every memo keyed by their stamps.
  if (moved || relinked || p === undefined) state.slotVersions[slot] = ++state.version
  remakeBins(rt, state, slot)
  if (!moved && !relinked) return
  // The impostor cards of its roots are written again from the composed worlds they read.
  rt.gpu.impostors?.worldsMoved(slotRanks(state, slot))
  moveGroups(rt, state, slot)
}
