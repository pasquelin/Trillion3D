/**
 * THE CPU WORLD OF A ROOT A PARENT COMPOSES (`gpuCompose.ts`): lazy, its `elements` composed on
 * read (`composeOnRead.ts`) — one product a read, none a move.
 */
import { MATRIX_VALUES } from '../../../math/src/batch/strides.ts'
import { multiplyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import type { ComposedView, ComposeState } from './gpuComposeState.ts'
import { composeOnRead, plainAgain } from './composeOnRead.ts'

/** The version of root `rank`'s composition: its slot's, which moves with its parent's world and
 *  its slot's links. */
const versionOf = (state: ComposeState, rank: number) =>
  state.parentOf[rank] === NO_INDEX ? 0 : state.slotVersions[state.parentOf[rank]]

/**
 * The composed world of root `rank`, as a CPU reader reads it: its parent's world times its local
 * matrix, by `multiplyMatrix4` — the doubles the GPU composes (`gpuComposeWgsl.ts`) —, written into
 * the root's row view the first time it is read since its parent or a link of its slot moved, never
 * otherwise. The roots a parent composes carry this as the `elements` of their world, so every CPU
 * reader of a world — the impostor cards, the winding of a row's draw bin, a row written again —
 * reads the world the GPU draws, and nothing writes it between two reads.
 */
function composedWorld(state: ComposeState, rank: number, view: Float64Array) {
  const slot = state.parentOf[rank]
  if (slot === NO_INDEX) return
  multiplyMatrix4(
    view,
    state.worlds.subarray(slot * MATRIX_VALUES, slot * MATRIX_VALUES + MATRIX_VALUES),
    state.localMats.subarray(rank * MATRIX_VALUES, rank * MATRIX_VALUES + MATRIX_VALUES),
  )
}

/** The `elements` of root `rank`'s world refresh on read (`composedWorld`); its `stamp` moves with
 *  its slot's composition, which a memo of what is derived from the world is keyed by. The state
 *  keeps the view it composes, which its unlink lets go whatever list the ranks then name. */
export function installComposedWorld(rt: WebgpuPagesRuntime, rank: number) {
  const world = rt.layout.selectionRoots[rank]?.world as ComposedView | undefined
  if (!world) return
  const state = rt.compose!
  state.views.set(rank, world)
  composeOnRead(
    world,
    state,
    () => versionOf(state, rank),
    (out) => composedWorld(state, rank, out),
  )
  Object.defineProperty(world, 'stamp', { configurable: true, get: () => versionOf(state, rank) })
}

/** The view root `rank` was composed at is a plain view again: a parent composes it no more. */
export function removeComposedWorld(state: ComposeState, rank: number) {
  const world = state.views.get(rank)
  if (!world) return
  state.views.delete(rank)
  plainAgain(world, state)
  delete world.stamp
}
