/**
 * A PARENT'S MOVE FOLLOWED (`gpuCompose.ts`): its world held, its rows' draw bins made again when
 * its winding turned, the tree groups and the impostor cards of its roots told, its move told to
 * the shadow mobility.
 */
import { matrixWindingCw } from '../../../sdk-core/src/index.ts'
import { sameElements } from '../../../math/src/matrix/matrixElements.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { moveRootRows } from '../webgpu/pages/render/movedRoot.ts'
import { slotRanks, type ComposeState } from './gpuComposeState.ts'

/** The draw bins of the rows of `slot`'s roots are made again, from the world the GPU composes,
 *  when its winding turned: a mirror changes which face each row's bin culls (`pipelineFor.ts`).
 *  The rows are written as a row moved is (`moveRootRows`), once a turn, never a move. */
function remakeBins(rt: WebgpuPagesRuntime, state: ComposeState, slot: number) {
  const cw = matrixWindingCw(state.worlds.subarray(slot * 16, slot * 16 + 16))
  const was = state.winding[slot]
  state.winding[slot] = cw
  if (was === undefined || was === cw) return
  for (const rank of state.ranksOf[slot])
    if (state.parentOf[rank] === slot) moveRootRows(rt, rt.layout.selectionRoots[rank], rank)
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

/** The impostor cards of `slot`'s roots follow the parent's move: each card is written again from
 *  the composed world its root reads (`composedWorld`). */
function moveCards(rt: WebgpuPagesRuntime, state: ComposeState, slot: number) {
  rt.gpu.impostors?.worldsMoved(slotRanks(state, slot))
}

/** The parent's world at `slot`, held; its move told to the shadow mobility — the rows pass stales
 *  the pages its roots' rows left and entered (`rowCastWgsl.ts`) — and the temporal pyramid. */
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
  const moved = p !== undefined && !sameElements(state.worlds, world, slot * 16)
  if (moved || p === undefined) state.parentsDirty = true
  state.worlds.set(world, slot * 16)
  state.version++
  remakeBins(rt, state, slot)
  if (moved || relinked) moveCards(rt, state, slot)
  if (moved || relinked) moveGroups(rt, state, slot)
  // A parent's move moves its roots: its first makes them moving casters (`mobility.moveLead`).
  if (moved) rt.lights.mobility.moveLead(slot, state.ranksOf[slot])
}
