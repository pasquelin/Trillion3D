/**
 * THE COMPOSITION'S STATE (`gpuCompose.ts`): the links of the roots a parent composes — each one's
 * parent slot and local matrix —, the parents' worlds, the lists the passes run over and
 * what each pass last ran at; grown with the session's roots.
 */
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import { PACKED_MATRIX_WORDS } from '../../../../math/src/float/splitDouble.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { createDenseKeySet } from '../../geometry/cut/adoption/denseKeys.ts'
import { createChangedRuns } from '../../geometry/residency/ranges.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import type { Readers } from './composeReaders.ts'
import type { ComposeGpu } from './gpuComposeGpu.ts'
import type { MatrixElements } from '../../session/host/matrixElements.ts'
import {
  movedList,
  noteMoved,
  noteMovedRank,
  takeMoved,
  type MovedList,
} from '../roots/rootMoves.ts'

/** What the composed roots are linked by: each one's parent and local matrix. */
function composeTables(roots: number) {
  return {
    roots,
    parentOf: new Uint32Array(Math.max(1, roots)).fill(NO_INDEX),
    locals: new Uint32Array(Math.max(1, roots) * PACKED_MATRIX_WORDS),
    /** Each linked root's local matrix, as the doubles it was linked by: what a CPU reader of its
     *  world composes with its parent's (`composedWorld`). */
    localMats: new Float64Array(Math.max(1, roots) * MATRIX_VALUES),
  }
}

/** The clock the slots' versions are drawn from, and what reads them. */
function composeClock() {
  return {
    /** The clock the versions are drawn from, and each slot's version: drawn anew whenever its
     *  parent's world, or one of its links, moves — a moving parent leaves every other slot's
     *  roots composed (`composeOnRead.ts`). */
    version: 1,
    slotVersions: [] as number[],
    /** The tree groups each slot's roots stand in, for the selection that named them. */
    groups: undefined as { cut: WeakRef<object>; bySlot: Map<number, Int32Array> } | undefined,
    /** The rows no root reads that a parent composes for their readers (`composeReaders.ts`). */
    readers: new Map() as Readers,
    /** The roots a parent composes, each once: what a pass over every composed root lists. */
    rankList: createDenseKeySet(),
  }
}

/** What the passes run over, and what each last ran at. */
function composePasses() {
  return {
    /**
     * The composed roots whose world the next worlds pass writes anew — the roots of each slot whose
     * parent moved or whose links moved, the composed roots a host write named —, every one when a
     * table the passes write was made anew. Taken by the worlds pass into the frame's list
     * (`frameRanks`), which the roots and root boxes passes read too, and handed to the passes that
     * derive from the composed worlds later — the tree's leaves —, each of which
     * takes its own (`owed`): only the dirty roots are uploaded, so a parent's move costs the
     * roots it composes, never every composed root.
     */
    composed: movedList(),
    owed: {
      /** Whose leaves the tree's leaves pass writes again. */
      leaves: movedList(),
    },
    /** The frame's composed roots, the first `frameCount` of `frameRanks`, as the worlds pass took
     *  them: what the worlds, roots and root boxes passes run over. */
    frameRanks: new Int32Array(8),
    frameCount: 0,
    /** What each pass last ran over: the composition's version. */
    ranAt: {
      worlds: -1,
      roots: -1,
    },
    /** The slots whose parent's world was set since the parents went up, and the roots whose link
     *  moved since the links did: sent in runs (`frameParents`), every one with a table made. */
    parentsMoved: createChangedRuns(),
    linksMoved: createChangedRuns(),
    /** Moves with what the passes compose — a parent's world, the links, the
     *  parents' buffer —, as each frame sends it (`frameParents`): a pass runs until it ran at it. */
    composedAt: 0,
  }
}

/** The slots the parents take, and the worlds sent for them. */
function composeSlots() {
  return {
    /** The roots each slot composes, listed once as its links change (`slotRanks`). */
    linked: new Map<number, Int32Array>(),
    /** The world view each composed root was composed at: what its unlink lets go, even once a
     *  shortened list names another root, or none, at its rank (`removeComposedWorld`). */
    views: new Map<number, MatrixElements>(),
    /** Each linked parent's slot. */
    parentIds: new Map<object, number>(),
    /** The roots each slot linked, some since taken by another slot; the slots no parent holds. */
    ranksOf: [] as number[][],
    freeSlots: [] as number[],
    /** Slots taken so far: the parent worlds sent each frame. */
    slots: 0,
    /** Each parent's world as last sent, in double. */
    worlds: new Float64Array(MATRIX_VALUES),
    packed: new Uint32Array(PACKED_MATRIX_WORDS),
    /** The frame whose parents the GPU holds. */
    frame: -1,
    /** A parent moved since the frame last sent the parents (`settleSlot`), and what the frame
     *  took of it, a link sent with it (`frameParents`): the roots pass tells the cut. */
    movedSince: false,
    moving: false,
    gpu: undefined as ComposeGpu | undefined,
  }
}

export function createComposeState(roots: number) {
  return {
    ...composeTables(roots),
    ...composeClock(),
    ...composePasses(),
    ...composeSlots(),
  }
}

export type ComposeState = ReturnType<typeof createComposeState>

/** Whether a parent composes root `rank` on the GPU now, read off the one compose state: the
 *  compose worlds pass writes its world (`../roots/rootWorlds.ts`), and its tree group stays open while it
 *  does (`../../geometry/dag/tree/treeFollow.ts`). */
export function composedRoot(rt: Pick<WebgpuPagesRuntime, 'compose'>, rank: number) {
  const state = rt.compose
  return !!state && rank < state.roots && state.parentOf[rank] !== NO_INDEX
}

/** The composed roots of `ranks` composed again by the next worlds pass: a host write landed on
 *  their cut worlds (`../../frame/render/worldUpload.ts`). */
export function composeHostWrites(
  rt: Pick<WebgpuPagesRuntime, 'compose'>,
  ranks: ArrayLike<number>,
) {
  const state = rt.compose
  if (!state) return
  for (let k = 0; k < ranks.length; k++)
    if (composedRoot(rt, ranks[k])) noteMovedRank(state.composed, ranks[k])
}

/** `state` over `roots` roots, those it held kept and linked. Its GPU tables are laid out for the
 *  roots: made again at the next frame, the links sent whole. */
export function growComposeState(state: ComposeState, roots: number) {
  state.parentOf = resized(state.parentOf, roots, NO_INDEX)
  state.locals = resized(state.locals, roots * PACKED_MATRIX_WORDS)
  state.localMats = resized(state.localMats, roots * MATRIX_VALUES)
  state.roots = roots
  state.gpu?.dispose()
  state.gpu = undefined
}

/** The roots `slot` composes now, listed once as its links change: what a move of its parent
 *  names, without a list made a move. */
export function slotRanks(state: ComposeState, slot: number) {
  let ranks = state.linked.get(slot)
  if (!ranks) {
    let count = 0
    const held = state.ranksOf[slot]
    for (const rank of held) if (state.parentOf[rank] === slot) count++
    ranks = new Int32Array(count)
    count = 0
    for (const rank of held) if (state.parentOf[rank] === slot) ranks[count++] = rank
    state.linked.set(slot, ranks)
  }
  return ranks
}

/** The lists `slot`'s links were read into are made again at their next read. */
export function slotMoved(state: ComposeState, slot: number) {
  state.groups?.bySlot.delete(slot)
  state.linked.delete(slot)
}

/** Every composed root, as the composition lists them: a view its next link or unlink moves. */
export const everyComposed = (state: ComposeState) =>
  state.rankList.list.subarray(0, state.rankList.count)

/** The composed roots `list` names, taken: increasing, or every composed root once it names them
 *  all — a view the next take overwrites, sent at once. */
export const takeComposed = (state: ComposeState, list: MovedList) =>
  takeMoved(list) ?? everyComposed(state)

/** The frame's composed roots, `ranks` — every one when undefined —, owed to the passes that derive
 *  from their worlds later: the tree's leaves. */
export function oweComposed(state: ComposeState, ranks: Int32Array | undefined) {
  if (ranks) noteMoved(state.owed.leaves, ranks)
  else state.owed.leaves.whole = true
}
