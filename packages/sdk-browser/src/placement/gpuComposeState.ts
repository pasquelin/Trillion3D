/**
 * THE COMPOSITION'S STATE (`gpuCompose.ts`): the links of the roots a parent composes — each one's
 * parent slot and local matrix —, the parents' worlds, the lists the passes run over and
 * what each pass last ran at; grown with the session's roots.
 */
import { MATRIX_VALUES } from '../../../math/src/batch/strides.ts'
import { PACKED_MATRIX_WORDS } from '../../../math/src/float/splitDouble.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import { createMirroredKeys } from '../webgpu/cut/denseKeys.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import type { Readers } from './composeReaders.ts'
import type { ComposeGpu } from './gpuComposeGpu.ts'

export function createComposeState(roots: number) {
  return {
    roots,
    parentOf: new Uint32Array(Math.max(1, roots)).fill(NO_INDEX),
    locals: new Uint32Array(Math.max(1, roots) * PACKED_MATRIX_WORDS),
    /** Each linked root's local matrix, as the doubles it was linked by: what a CPU reader of its
     *  world composes with its parent's (`composedWorld`). */
    localMats: new Float64Array(Math.max(1, roots) * MATRIX_VALUES),
    /** The world versions each root's CPU world was composed at (`composedWorld`), and the
     *  current one: it moves whenever a parent's world, or a link, does. */
    refreshed: new Uint32Array(Math.max(1, roots)),
    version: 1,
    /** The tree groups each slot's roots stand in, for the selection that named them. */
    groups: undefined as { cut: WeakRef<object>; bySlot: Map<number, Int32Array> } | undefined,
    /** The rows no root reads that a parent composes for their readers (`composeReaders.ts`). */
    readers: new Map() as Readers,
    /** The roots a parent composes, a thread each of the worlds, roots, root boxes and leaves
     *  passes, and the page-table rows of those roots, a thread each of the rows pass
     *  (`composedRows.ts`). */
    rankList: createMirroredKeys(),
    rowList: createMirroredKeys(),
    /** Roots linked or unlinked since the rows list followed them (`followComposedRows`). */
    relinked: [] as number[],
    /** False until the rows list follows the table: listed again whole (`followComposedRows`). */
    rowsFollowed: false,
    /** What each pass last ran over: the composition's version, the cut's host writes, the motion
     *  bound. */
    ranAt: {
      worlds: -1,
      roots: -1,
      rows: -1,
      frameWrites: -1,
      motion: undefined as GPUBuffer | undefined,
    },
    /** The GPU's previous worlds hold every composed root's world, and its motion rows are
     *  identity: a roots pass would write nothing new (`decideComposedMotion`). */
    previousCurrent: false,
    motionIdentity: false,
    /** The frame whose roots pass ran, and whether `previous` was current before it did. */
    ranFrame: -1,
    ranCurrent: false,
    /** A parent's world was set since the parents went up. */
    parentsDirty: true,
    /** Moves with what the passes compose — a parent's world, the links, a motion's start, the
     *  parents' buffer —, as each frame sends it (`frameParents`): a pass runs until it ran at it. */
    composedAt: 0,
    /** The roots each slot composes, listed once as its links change (`slotRanks`). */
    linked: new Map<number, Int32Array>(),
    /** Each linked parent's slot. */
    parentIds: new Map<object, number>(),
    /** The roots each slot linked, some since taken by another slot; the slots no parent holds. */
    ranksOf: [] as number[][],
    freeSlots: [] as number[],
    /** Slots taken so far: the parent worlds sent each frame. */
    slots: 0,
    /** Each parent's world as last sent, in double. */
    worlds: new Float64Array(MATRIX_VALUES),
    /** Each parent's world at the last drawn frame, in double. */
    previous: new Float64Array(MATRIX_VALUES),
    /** Whether each parent's world reverses orientation, as the draw bins of its rows were made
     *  for it (`../webgpu/pages/prepare/pipelineFor.ts`). */
    winding: [] as boolean[],
    packed: new Uint32Array(PACKED_MATRIX_WORDS),
    /** The worlds pass's parameters (the ranges' passes keep theirs, `rangeParams`). */
    worldParams: new Uint32Array(4),
    /** Roots linked since the last frame, with the world their motion starts from. */
    seeds: new Map<number, Float32Array<ArrayBuffer>>(),
    /** The temporal pass's decision and eye (`composedMotion.ts`), as the roots pass reads it. */
    motionMode: new Uint32Array(8),
    /** The motion buffer the roots pass wrote this frame, undefined without one. */
    motionBound: undefined as GPUBuffer | undefined,
    linksDirty: true,
    /** The frame whose parents the GPU holds. */
    frame: -1,
    /** A parent moved since the last drawn frame: the temporal pass reads the motion. */
    moving: false,
    gpu: undefined as ComposeGpu | undefined,
  }
}

export type ComposeState = ReturnType<typeof createComposeState>

/** Whether a parent composes root `rank` on the GPU now, read off the one compose state: the
 *  compose worlds pass writes its world (`rootWorlds.ts`), and its tree group stays open while it
 *  does (`../gpu/dag/treeFollow.ts`). */
export function composedRoot(rt: Pick<WebgpuPagesRuntime, 'compose'>, rank: number) {
  const state = rt.compose
  return !!state && rank < state.roots && state.parentOf[rank] !== NO_INDEX
}

/** Root `rank`'s motion starts from the pose the CPU motion last accumulated it at — the one
 *  `../taa/motion.ts` would compare its next world with —, its world without one. */
export function seedMotion(rt: WebgpuPagesRuntime, state: ComposeState, rank: number) {
  const world =
    rt.gpu.temporal?.motion.poseOf(rank) ?? rt.layout.selectionRoots[rank].world.elements
  state.seeds.set(rank, Float32Array.from(world))
}

/** `state` over `roots` roots, those it held kept and linked. Its GPU tables are laid out for the
 *  roots: made again at the next frame, the links sent whole, and each linked root's motion starts
 *  again from the pose its last image held. */
export function growComposeState(rt: WebgpuPagesRuntime, state: ComposeState, roots: number) {
  const held = state.roots
  state.parentOf = resized(state.parentOf, roots, NO_INDEX)
  state.locals = resized(state.locals, roots * PACKED_MATRIX_WORDS)
  state.localMats = resized(state.localMats, roots * MATRIX_VALUES)
  state.refreshed = resized(state.refreshed, roots)
  state.roots = roots
  state.gpu?.dispose()
  state.gpu = undefined
  state.linksDirty = true
  for (let rank = 0; rank < held; rank++)
    if (state.parentOf[rank] !== NO_INDEX) seedMotion(rt, state, rank)
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
