/**
 * PLACEMENTS COMPOSED ON THE GPU UNDER A MOVED PARENT.
 *
 * A row of an instance buffer whose mesh only follows its parent is linked once: the mesh's own
 * local matrix and the parent's slot. From then on a parent that moves sends one matrix; two
 * compute passes write, for every linked root, `parent · local` in exact double arithmetic
 * (`gpuComposeWgsl.ts`) into the cut's worlds — the exact translation behind them, which each cut
 * reads at its own eye (`gpu/dag/shader/worldPoseWgsl.ts`) —, and the temporal motion, and into the world words of every page-table row of that root: the very
 * single-precision words the CPU would have written. The frame hears a pose move as from any
 * engine write (`engineMovedInPlace`): every reader of the scene revision follows; the GPU cut,
 * which compares the CPU worlds it is sent, hears it from the roots pass (`worldsMovedOnGpu`) and
 * cuts again under the composed worlds. The CPU rows of a linked root keep the world of their last
 * full write: nothing on the CPU reads them while the parent turns.
 *
 * The temporal motion of a linked root is the CPU's to the word (`../taa/motion.ts`): the roots pass
 * computes it from the root's composed single-precision world and the one the GPU holds for it at the
 * last accumulated image, as the temporal pass decides this image (`composedMotion.ts`). That
 * decision is a uniform written after the pass is encoded and before the image is submitted, as the
 * CPU motion's own write is: every reader of the motion sees it.
 *
 * The shadows follow a parent's move as they follow a moved node's (`movedBatch.ts`): the box of
 * the slot's linked roots in the parent's frame (`slotBoxes`, the union of each root's local box
 * through its local matrix, made when the links change) is declared at the parent's last world and
 * at its new one, each on its own, the second only when it differs — one box per moved parent, at
 * most two per move, never a row. Its first move makes its roots moving casters, once
 * (`mobility.moveLead`); a later move stales the moving casters alone. The rows pass writes each
 * linked row's world sphere, what the shadow cull drops a row by, from its composed world.
 *
 * Everything a composed world gives is derived on the GPU, the CPU's to the word: the roots pass
 * writes the primitive stretch every cut projects its errors through (`gpuStretchWgsl.ts`) and the
 * root's world box; the rows pass the Hi-Z corners and the world-dependent levels of detail of each
 * row (`gpuComposeDerivedWgsl.ts`); the members pass the leaf boxes the placement tree is refitted
 * over (`gpu/dag/treeRefit.ts`). The CPU readers — impostor cards, transparent depth, the winding —
 * read the lazy world of the root once a frame, as waves, a soft body and a skeleton do. A link is
 * never refused for what reads its row: the rows no root reads — a blended surface's, or a row
 * whose root is not built yet — are composed for their readers (`composeReaders.ts`).
 */
import { composeWorld } from './composeWorld.ts'
import type { MatrixElements } from '../host/matrixElements.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import { uniformSlotBytes, uniformStride } from '../residency/pools.ts'
import { dispatchRows } from '../gpu/dispatch/grid.ts'
import {
  composeMembersWgsl,
  COMPOSE_ROOTS_WGSL,
  COMPOSE_ROWS_WGSL,
  MATRIX_DOUBLES,
  NONE,
  PART_CORNERS,
  PART_LODS,
  PART_SPHERES,
} from './gpuComposeWgsl.ts'
import { DAG_BINDING, dagPartEntries } from '../gpu/dag/shader/bindings.ts'
import type { RefitLayout } from '../gpu/dag/treeRefitWgsl.ts'
import { nodeLayout } from '../gpu/dag/treeRefit.ts'
import { composedRowInputs } from './composedRowInputs.ts'
import { MOTION_SKIP } from './composedMotion.ts'
import { packDoubles } from '../../../math/src/float/splitDouble.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { preparedComputePipeline, preparedPipelines } from '../lighting/deferred/fullscreen.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { GpuSelection } from '../gpu/core/selection.ts'
import { placedBy, type PlacementRows } from './rows.ts'
import { MOVE_PROMOTED, rootRankOfRow } from './update.ts'
import { moveRootRows } from '../webgpu/pages/render/movedRoot.ts'
import { BOX_VALUES, matrixWindingCw } from '../../../sdk-core/src/index.ts'
import { WORLD_ORIGIN_BYTES } from '../gpu/dag/worldOrigins.ts'
import { PRIMITIVE_BYTES } from '../gpu/dag/cameraRanges.ts'
import { linkedRowSpheres } from '../webgpu/shadow/spheres.ts'
import { sameElements } from '../../../math/src/matrix/matrixElements.ts'
import {
  composedRoot,
  declareSlotMove,
  holdSlotBox,
  linkBox,
  remakeSlotBox,
} from './composeBoxes.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { COMPOSE_MEMBERS_PASS, COMPOSE_ROOTS_PASS, COMPOSE_ROWS_PASS } from '../stage/passLabels.ts'
import type { ComposedLeaves } from '../gpu/dag/treeFollow.ts'
import { adoptReaders, dropReaders, holdReaders, writeReaders } from './composeReaders.ts'

/** A compose pass's bind group and what it names: made again only when one of them moves. */
const heldGroup = () => ({
  identity: createWebgpuBindIdentity(),
  group: undefined as GPUBindGroup | undefined,
})
type HeldGroup = ReturnType<typeof heldGroup>

/** A row linked to a parent: its rows, its rank there, its mesh's local matrix. */
export type PlacementLink = { rows: PlacementRows; index: number; local: ArrayLike<number> }

function createComposeState(roots: number) {
  return {
    roots,
    parentOf: new Uint32Array(Math.max(1, roots)).fill(NONE),
    locals: new Uint32Array(Math.max(1, roots) * MATRIX_DOUBLES * 2),
    /** Each linked root's local matrix, as the doubles it was linked by: what a CPU reader of its
     *  world composes with its parent's (`composedWorld`). */
    localMats: new Float64Array(Math.max(1, roots) * 16),
    /** Each linked root's local box, seven doubles — the box, then whether it has one —, which the
     *  roots pass carries by the composed world into its world box. */
    boxWords: new Uint32Array(Math.max(1, roots) * ROOT_BOX_WORDS),
    /** The world versions each root's CPU world was composed at (`composedWorld`), and the
     *  current one: it moves whenever a parent's world, or a link, does. */
    refreshed: new Uint32Array(Math.max(1, roots)),
    version: 1,
    /** The tree groups each slot's roots stand in, for the selection that named them. */
    groups: undefined as { cut: WeakRef<object>; bySlot: Map<number, Int32Array> } | undefined,
    /** The rows' inputs the rows pass derives their words from (`composedRowInputs.ts`). */
    inputs: undefined as
      | { buffer: GPUBuffer; packed: Uint32Array<ArrayBuffer>; rows: number; scratch: Float64Array }
      | undefined,
    /** The rows no root reads that a parent composes for their readers (`composeReaders.ts`). */
    readers: new Map() as Parameters<typeof dropReaders>[0],
    /** Each linked parent's slot. */
    parentIds: new Map<object, number>(),
    /** The roots each slot linked, some since taken by another slot; the slots no parent holds. */
    ranksOf: [] as number[][],
    freeSlots: [] as number[],
    /** Slots taken so far: the parent worlds sent each frame. */
    slots: 0,
    /** Each parent's world as last sent, in double. */
    worlds: new Float64Array(16),
    /** Each parent's world at the last drawn frame, in double. */
    previous: new Float64Array(16),
    /** Whether each parent's world reverses orientation, as the draw bins of its rows were made
     *  for it (`../webgpu/pages/prepare/pipelineFor.ts`). */
    winding: [] as boolean[],
    packed: new Uint32Array(MATRIX_DOUBLES * 2),
    /** The roots pass's parameters, a uniform slot (`uniformStride`) a range of the cut's worlds;
     *  the rows pass's four. */
    rootParams: new Uint32Array(64),
    rowParams: new Uint32Array(4),
    /** Each linked root's local box through its local matrix: its box in its parent's frame. */
    rankBoxes: new Float64Array(Math.max(1, roots) * BOX_VALUES),
    /** Each slot's box in its parent's frame: the union of its linked roots' (`rankBoxes`). */
    slotBoxes: new Float64Array(BOX_VALUES),
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
type ComposeGpu = ReturnType<typeof createComposeGpu>

/**
 * Takes `world` as `parent`'s world and links `links` to it. `whole`: they are every row that
 * follows it, any other root it linked follows none any more — no link at all frees its slot —;
 * otherwise they are rows it holds, at a new local matrix. Every link is taken, whatever reads its
 * row (`linkedRanks`). A parent whose world
 * turns its winding has the draw bins of its rows made again from the world the GPU composes
 * (`remakeBins`).
 */
export function composeWebgpuPlacements(
  rt: WebgpuPagesRuntime,
  parent: object,
  world: ArrayLike<number>,
  links: readonly PlacementLink[],
  whole: boolean,
) {
  const { mobility } = rt.lights,
    state = composeState(rt)
  const p = state.parentIds.get(parent)
  if (p === undefined && !links.length) return
  const { ranks, rooted, readers } = linkedRanks(rt, links)
  const slot = takeSlot(state, parent, p, world)
  // The shadow pages the slot's roots cover at the parent's last world: a slot linked now has
  // none of its own, its rows' CPU write in this call declares them (`webgpuPlacements.ts`). The
  // static casters under it stay unless a root it changes is still or its parent's move is a first.
  let movingOnly = true
  holdSlotBox(state, p)
  for (const rank of ranks) movingOnly &&= mobility.moves(rank)
  if (whole) movingOnly = unlinkHeld(rt, state, slot, ranks) && movingOnly
  if (whole) dropReaders(state.readers, slot)
  if (readers.length) holdReaders(state.readers, slot, parent, readers, whole)
  if (!ranks.length && !readers.length && whole) {
    state.parentIds.delete(parent)
    state.freeSlots.push(slot)
    declareSlotMove(rt, state, undefined, movingOnly)
    return
  }
  linkRanks(rt, state, { slot, ranks, links: rooted, whole })
  const relinked = ranks.length > 0 || whole
  if (relinked) remakeSlotBox(state, slot)
  settleSlot(rt, state, { slot, p, world, relinked, movingOnly })
  writeReaders(state.readers, slot, world)
  // Poses moved and no node entered or left: the frame hears it as any engine pose write.
  rt.run.gate.engineMovedInPlace()
}

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
    for (const rank of state.ranksOf[slot])
      if (state.parentOf[rank] === slot) named.add(selection.groupOf(rank))
    named.delete(-1)
    state.groups.bySlot.set(slot, (groups = Int32Array.from(named)))
  }
  selection.groupsMoved(groups)
}

/** The impostor cards of `slot`'s roots follow the parent's move: each card is written again from
 *  the composed world its root reads (`composedWorld`). */
function moveCards(rt: WebgpuPagesRuntime, state: ComposeState, slot: number) {
  const cards = rt.gpu.impostors
  if (!cards) return
  const ranks = state.ranksOf[slot].filter((rank) => state.parentOf[rank] === slot)
  cards.worldsMoved(ranks)
}

/** The parent's world at `slot`, held; its move declared to the shadows (`declareSlotMove`) and the
 *  temporal pyramid. */
function settleSlot(
  rt: WebgpuPagesRuntime,
  state: ComposeState,
  {
    slot,
    p,
    world,
    relinked,
    movingOnly,
  }: {
    slot: number
    p: number | undefined
    world: ArrayLike<number>
    relinked: boolean
    movingOnly: boolean
  },
) {
  // Whether the parent moved: one linked now, or sent at the world it held, did not.
  const moved = p !== undefined && !sameElements(state.worlds, world, slot * 16)
  state.worlds.set(world, slot * 16)
  state.version++
  remakeBins(rt, state, slot)
  if (moved || relinked) moveCards(rt, state, slot)
  if (moved || relinked) moveGroups(rt, state, slot)
  // A parent's move moves its roots: its first makes them moving casters (`mobility.moveLead`).
  if (moved && rt.lights.mobility.moveLead(slot, state.ranksOf[slot]) === MOVE_PROMOTED)
    movingOnly = false
  if (p !== undefined && (moved || relinked)) declareSlotMove(rt, state, slot, movingOnly)
}

/** The session's composition over its root list: a growth appends to it, its links kept; a list
 *  shortened — another list — unlinks every root through the one unlink path (`unlinkHeld`)
 *  before it is made again. */
function composeState(rt: WebgpuPagesRuntime) {
  const roots = rt.layout.selectionRoots.length,
    state = rt.compose
  if (state && roots > state.roots) growComposeState(rt, state, roots)
  else if (state && roots < state.roots) {
    for (let slot = 0; slot < state.ranksOf.length; slot++)
      if (state.ranksOf[slot]?.length) unlinkHeld(rt, state, slot, [])
    state.gpu?.dispose()
    rt.compose = undefined
  }
  return (rt.compose ??= createComposeState(roots))
}

/** Root `rank`'s motion starts from the pose the CPU motion last accumulated it at — the one
 *  `../taa/motion.ts` would compare its next world with —, its world without one. */
function seedMotion(rt: WebgpuPagesRuntime, state: ComposeState, rank: number) {
  const world =
    rt.gpu.temporal?.motion.poseOf(rank) ?? rt.layout.selectionRoots[rank].world.elements
  state.seeds.set(rank, Float32Array.from(world))
}

/** `state` over `roots` roots, those it held kept and linked. Its GPU tables are laid out for the
 *  roots: made again at the next frame, the links sent whole, and each linked root's motion starts
 *  again from the pose its last image held. */
function growComposeState(rt: WebgpuPagesRuntime, state: ComposeState, roots: number) {
  const held = state.roots
  state.parentOf = resized(state.parentOf, roots, NONE)
  state.locals = resized(state.locals, roots * MATRIX_DOUBLES * 2)
  state.localMats = resized(state.localMats, roots * 16)
  state.boxWords = resized(state.boxWords, roots * ROOT_BOX_WORDS)
  state.refreshed = resized(state.refreshed, roots)
  state.rankBoxes = resized(state.rankBoxes, roots * BOX_VALUES)
  state.roots = roots
  state.gpu?.dispose()
  state.gpu = undefined
  state.linksDirty = true
  for (let rank = 0; rank < held; rank++)
    if (state.parentOf[rank] !== NONE) seedMotion(rt, state, rank)
}

/**
 * The composed world of root `rank`, as a CPU reader reads it: its parent's world times its local
 * matrix, by `composeWorld` — the doubles the GPU composes (`gpuComposeWgsl.ts`) —, written into
 * the root's row view the first time it is read since a parent or a link moved, never otherwise: a
 * reader costs one product, and a move of the parent none. The roots a parent composes carry this
 * as the `elements` of their world (`installComposedWorld`), so every CPU reader of a world — the
 * impostor cards, the winding of a row's draw bin, a row written again — reads the world the GPU
 * draws, and nothing writes it between two reads.
 */
function composedWorld(state: ComposeState, rank: number, view: Float64Array) {
  if (state.refreshed[rank] === state.version) return
  state.refreshed[rank] = state.version
  const slot = state.parentOf[rank]
  if (slot === NONE) return
  composeWorld(
    view,
    state.worlds.subarray(slot * 16, slot * 16 + 16),
    state.localMats.subarray(rank * 16, rank * 16 + 16),
  )
}

/** The `elements` of root `rank`'s world refresh on read (`composedWorld`); its `stamp` moves with
 *  the composition, which a memo of what is derived from the world is keyed by. */
function installComposedWorld(rt: WebgpuPagesRuntime, rank: number) {
  const world = rt.layout.selectionRoots[rank]?.world as
    (MatrixElements & { stamp?: number }) | undefined
  if (!world || Object.getOwnPropertyDescriptor(world, 'elements')?.get) return
  const view = world.elements as Float64Array
  const state = rt.compose!
  state.refreshed[rank] = 0
  Object.defineProperty(world, 'elements', {
    configurable: true,
    enumerable: true,
    get: () => (composedWorld(state, rank, view), view),
  })
  Object.defineProperty(world, 'stamp', {
    configurable: true,
    get: () => (state.parentOf[rank] === NONE ? 0 : state.version),
  })
}

/** Root `rank`'s world is a plain view again: a parent composes it no more. */
function removeComposedWorld(rt: WebgpuPagesRuntime, rank: number) {
  const world = rt.layout.selectionRoots[rank]?.world as
    (MatrixElements & { stamp?: number }) | undefined
  if (!world || !Object.getOwnPropertyDescriptor(world, 'elements')?.get) return
  const view = world.elements
  delete world.stamp
  Object.defineProperty(world, 'elements', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: view,
  })
}

/** The roots of a growth read views on their new rows (`growth.ts`): the composed ones carry the
 *  refreshing `elements` again, their row holding the world they were last read at. */
export function rebindComposedWorlds(rt: WebgpuPagesRuntime) {
  const state = rt.compose
  if (!state) return
  for (let rank = 0; rank < state.roots && rank < rt.layout.selectionRoots.length; rank++)
    if (state.parentOf[rank] !== NONE) installComposedWorld(rt, rank)
  // The rows a root reads now are composed by the roots pass from here on.
  const roots = rt.layout.selectionRoots
  for (const { slot, parent, readers } of adoptReaders(state.readers, (rows, index) =>
    rootRankOfRow(roots, rows, index),
  ))
    composeWebgpuPlacements(
      rt,
      parent,
      state.worlds.slice(slot * 16, slot * 16 + 16),
      readers,
      false,
    )
}

/** The root rank of each link a root reads (`ranks`, with those links as `rooted`), and the links
 *  whose rows only a CPU reader holds — no root reads them, or a blended copy does too: composed for
 *  that reader (`composeReaders.ts`). A link is never refused for what reads its row: waves, a soft
 *  body or a skeleton read the root's world, which a composed root gives as it is read. */
function linkedRanks(rt: WebgpuPagesRuntime, links: readonly PlacementLink[]) {
  const ranks: number[] = [],
    rooted: PlacementLink[] = [],
    readers: PlacementLink[] = [],
    blended = new Map<PlacementRows, boolean>()
  for (const link of links) {
    const rank = rootRankOfRow(rt.layout.selectionRoots, link.rows, link.index)
    if (rank >= 0) {
      ranks.push(rank)
      rooted.push(link)
    }
    if (!blended.has(link.rows)) blended.set(link.rows, placedBy(rt.blendState.blendGpu, link.rows))
    if (rank < 0 || blended.get(link.rows)) readers.push(link)
  }
  return { ranks, rooted, readers }
}

/** The parent's slot: its own, or a new one at `world`, every per-slot table grown to hold it. */
function takeSlot(
  state: ComposeState,
  parent: object,
  p: number | undefined,
  world: ArrayLike<number>,
) {
  const slot = p ?? state.freeSlots.pop() ?? state.slots++
  if (p !== undefined) return slot
  state.parentIds.set(parent, slot)
  state.ranksOf[slot] = []
  state.winding[slot] = undefined as unknown as boolean
  state.worlds = resized(state.worlds, state.slots * 16)
  state.previous = resized(state.previous, state.slots * 16)
  state.slotBoxes = resized(state.slotBoxes, state.slots * BOX_VALUES)
  state.previous.set(world, slot * 16)
  return slot
}

/** Every root `slot` held and `ranks` does not keep follows no parent any more; whether every
 *  root it held was moving already. */
function unlinkHeld(rt: WebgpuPagesRuntime, state: ComposeState, slot: number, ranks: number[]) {
  const { mobility } = rt.lights,
    held = state.ranksOf[slot],
    kept = new Set(ranks)
  let movingOnly = true
  for (const rank of held) {
    if (state.parentOf[rank] !== slot) continue
    movingOnly &&= mobility.moves(rank)
    if (kept.has(rank)) continue
    removeComposedWorld(rt, rank)
    state.groups?.bySlot.delete(slot)
    state.parentOf[rank] = NONE
    mobility.follow(rank, -1)
    rt.run.gpuSelection?.composedPlacement(rank, false)
  }
  held.length = 0
  state.linksDirty = true
  return movingOnly
}

/** `ranks` follow `slot`, each at its link's local matrix. */
function linkRanks(
  rt: WebgpuPagesRuntime,
  state: ComposeState,
  {
    slot,
    ranks,
    links,
    whole,
  }: { slot: number; ranks: number[]; links: readonly PlacementLink[]; whole: boolean },
) {
  const roots = rt.layout.selectionRoots,
    held = state.ranksOf[slot]
  state.groups?.bySlot.delete(slot)
  for (let k = 0; k < ranks.length; k++) {
    const rank = ranks[k],
      was = state.parentOf[rank]
    if (whole || was !== slot) held.push(rank)
    // A root linked already keeps its own motion.
    if (was === NONE) seedMotion(rt, state, rank)
    state.parentOf[rank] = slot
    rt.lights.mobility.follow(rank, slot)
    rt.run.gpuSelection?.composedPlacement(rank, true)
    packDoubles(state.locals, rank * MATRIX_DOUBLES * 2, links[k].local)
    state.localMats.set(links[k].local as ArrayLike<number>, rank * 16)
    installComposedWorld(rt, rank)
    writeRootBox(state, rank, roots[rank])
    linkBox(state, rank, roots[rank], links[k].local)
  }
  if (ranks.length) state.linksDirty = true
}

/** Words of a root's entry in the roots pass's box inputs: six doubles and the flag. */
const ROOT_BOX_WORDS = 14

/** Root `rank`'s local box and whether it has a world box, as the roots pass reads them. */
function writeRootBox(
  state: ComposeState,
  rank: number,
  root: { localBox?: ArrayLike<number>; worldBox?: ArrayLike<number> },
) {
  const at = rank * ROOT_BOX_WORDS
  state.boxWords.fill(0, at, at + ROOT_BOX_WORDS)
  if (!root.localBox || !root.worldBox) return
  packDoubles(state.boxWords, at, root.localBox as ArrayLike<number>, 0, 6)
  state.boxWords[at + 12] = 1
}

function createComposeGpu(device: GPUDevice, rootCount: number) {
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const locals = device.createBuffer({
    label: 'Trillion3D composed locals',
    size: Math.max(1, rootCount) * MATRIX_DOUBLES * 8,
    usage: storage,
  })
  const parentOf = device.createBuffer({
    label: 'Trillion3D composed parents of',
    size: Math.max(1, rootCount) * 4,
    usage: storage,
  })
  const uniforms = [0, 1].map(() =>
    device.createBuffer({
      label: 'Trillion3D compose params',
      size: uniformSlotBytes(device.limits, 8),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  )
  const rootInputs = device.createBuffer({
    label: 'Trillion3D composed root boxes',
    size: Math.max(1, rootCount) * ROOT_BOX_WORDS * 4,
    usage: storage,
  })
  const memberParams = device.createBuffer({
    label: 'Trillion3D compose member params',
    size: 256 * 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const rootBoxes = device.createBuffer({
    label: 'Trillion3D composed world boxes',
    size: Math.max(1, rootCount) * 6 * 8,
    usage: storage,
  })
  const noMotion = device.createBuffer({ label: 'Trillion3D no motion', size: 64, usage: storage })
  // The writable bindings of the rows pass whose buffer is not made: one stand-in each, a binding
  // never aliasing another's range.
  const absent = [0, 1, 2].map(() =>
    device.createBuffer({ label: 'Trillion3D no row part', size: 64, usage: storage }),
  )
  const previous = device.createBuffer({
    label: 'Trillion3D composed previous worlds',
    size: Math.max(1, rootCount) * 64,
    usage: storage,
  })
  const motionMode = device.createBuffer({
    label: 'Trillion3D composed motion mode',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  return {
    locals,
    parentOf,
    rootInputs,
    rootBoxes,
    memberParams,
    parents: undefined as GPUBuffer | undefined,
    uniforms,
    noMotion,
    absent,
    previous,
    motionMode,
    /** The roots pass's group of each range of the cut's worlds, and the rows pass's. */
    rootGroups: [] as HeldGroup[],
    /** Words of the roots pass's parameters these tables hold, -1 before any write. */
    paramsWritten: -1,
    rowsGroup: heldGroup(),
    dispose() {
      locals.destroy()
      parentOf.destroy()
      rootInputs.destroy()
      rootBoxes.destroy()
      memberParams.destroy()
      this.parents?.destroy()
      for (const u of uniforms) u.destroy()
      noMotion.destroy()
      for (const buffer of absent) buffer.destroy()
      previous.destroy()
      motionMode.destroy()
    },
  }
}

/** The roots' and the rows' kernels, once a device, compiled off the thread: asked at a frame's
 *  entry once a parent holds a link (`askComposedPlacements`), the frames held until they landed,
 *  so the frame that composes binds them compiled. */
const composeKernels = oncePerDevice((device) => {
  const kernel = (module: GPUShaderModule) =>
    preparedComputePipeline(device, {
      label: module.label,
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    })
  return {
    roots: kernel(
      device.createShaderModule({ label: 'Trillion3D compose roots', code: COMPOSE_ROOTS_WGSL }),
    ),
    rows: kernel(
      device.createShaderModule({ label: 'Trillion3D compose rows', code: COMPOSE_ROWS_WGSL }),
    ),
  }
})

/** The members kernel for each layout of the nodes it reads, made once a device (`nodeTableWgsl`). */
const memberKernels = oncePerDevice((device) =>
  preparedPipelines(
    (nodes: RefitLayout['nodes']) =>
      preparedComputePipeline(device, {
        label: COMPOSE_MEMBERS_PASS,
        layout: 'auto',
        compute: {
          module: device.createShaderModule({
            label: COMPOSE_MEMBERS_PASS,
            code: composeMembersWgsl(nodes),
          }),
          entryPoint: 'main',
        },
      }),
    (nodes) => `${nodes.per}x${nodes.parts}`,
  ),
)

/**
 * The leaves the placement tree's refit fits over for the roots a parent composes (`treeFollow.ts`):
 * the box of each root's node carried by the world the GPU composes — the leaf `memberBox` makes
 * from a world the CPU holds. Every composed root is written whenever the tree is fitted again: a
 * thread each, a few products, only on the frames a parent moved one of them.
 */
export function composedLeaves(rt: WebgpuPagesRuntime): ComposedLeaves {
  return {
    has: (w) => composedRoot(rt, w),
    encode(encoder, { members, nodeParts }) {
      const state = rt.compose,
        device = rt.gpu.device,
        selection = rt.run.gpuSelection
      if (!state?.parentIds.size || !device || !selection) return
      const gpu = frameParents(rt, device)
      if (!gpu?.parents) return
      const pipeline = memberKernels(device).of(nodeLayout(nodeParts)).ask().get(),
        tables = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(1),
          entries: [
            { binding: DAG_BINDING.nodes, resource: { buffer: nodeParts.buffers[0] } },
            ...dagPartEntries({ nodes: nodeParts.buffers.slice(1) }),
          ],
        })
      const pass = encoder.beginComputePass({ label: COMPOSE_MEMBERS_PASS })
      pass.setPipeline(pipeline)
      pass.setBindGroup(1, tables)
      selection.worldRanges.forEach(({ first, count, frames }, r) => {
        const params = new Uint32Array([state.roots, first, count, 0])
        device.queue.writeBuffer(gpu.memberParams, r * 256, params)
        pass.setBindGroup(
          0,
          device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: gpu.memberParams, offset: r * 256, size: 16 } },
              { binding: 1, resource: { buffer: gpu.locals } },
              { binding: 2, resource: { buffer: gpu.parentOf } },
              { binding: 3, resource: { buffer: gpu.parents! } },
              {
                binding: 4,
                resource: { buffer: frames, offset: 0, size: count * PRIMITIVE_BYTES },
              },
              { binding: 5, resource: { buffer: members } },
            ],
          }),
        )
        dispatchRows(pass, ceilDiv(count, 64))
      })
      pass.end()
      rt.run.gpuComputeDispatches += selection.worldRanges.length
    },
  }
}

/** Asks the kernels the next frame binds once a parent holds a link
 *  (`../webgpu/frame/framePipelines.ts`); nothing while none does. */
export function askComposedPlacements(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!rt.compose?.parentIds.size) return
  const kernels = composeKernels(device)
  kernels.roots.ask()
  kernels.rows.ask()
  const nodes = rt.run.gpuSelection?.treeNodes
  if (nodes) memberKernels(device).of(nodes).ask()
}

/** Parent matrices for this frame, each world in doubles; notes whether one moved since the last. */
function writeParents(state: ComposeState) {
  const count = state.slots
  if (state.packed.length < count * MATRIX_DOUBLES * 2)
    state.packed = new Uint32Array(count * MATRIX_DOUBLES * 2)
  state.moving = false
  const { worlds, previous } = state
  for (let p = 0; p < count; p++) {
    const at = p * 16
    packDoubles(state.packed, p * MATRIX_DOUBLES * 2, worlds, at, 16)
    for (let k = at; k < at + 16; k++)
      if (previous[k] !== worlds[k]) {
        state.moving = true
        previous[k] = worlds[k]
      }
  }
}

/** The links and this frame's parents on the GPU, sent once per frame; undefined without links. */
function frameParents(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const state = rt.compose
  if (!state || !state.parentIds.size) return undefined
  const gpu = (state.gpu ??= createComposeGpu(device, state.roots))
  if (state.frame === rt.run.frame) return gpu
  state.frame = rt.run.frame
  // The roots pass names the motion buffer it binds, on the frames it runs.
  state.motionBound = undefined
  if (state.linksDirty) {
    // The tables are the capacity (`resized`): the roots' words alone go up.
    const roots = Math.max(1, state.roots)
    device.queue.writeBuffer(gpu.locals, 0, state.locals, 0, roots * MATRIX_DOUBLES * 2)
    device.queue.writeBuffer(gpu.parentOf, 0, state.parentOf, 0, roots)
    device.queue.writeBuffer(gpu.rootInputs, 0, state.boxWords, 0, roots * ROOT_BOX_WORDS)
    state.linksDirty = false
  }
  for (const [rank, pose] of state.seeds) device.queue.writeBuffer(gpu.previous, rank * 64, pose)
  state.seeds.clear()
  writeParents(state)
  const count = state.slots
  if (!gpu.parents || gpu.parents.size < count * MATRIX_DOUBLES * 8) {
    gpu.parents?.destroy()
    gpu.parents = device.createBuffer({
      label: 'Trillion3D composed parent worlds',
      size: count * MATRIX_DOUBLES * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  }
  device.queue.writeBuffer(gpu.parents, 0, state.packed, 0, count * MATRIX_DOUBLES * 2)
  return gpu
}

/** Whether the words `params` holds — the last written to the GPU's tables, `written` of them — say
 *  `ranges` and `roots`: numbers compared, nothing of a cut kept. */
function paramsHold(
  params: Uint32Array,
  written: number,
  ranges: GpuSelection['worldRanges'],
  roots: number,
  slot: number,
) {
  if (written !== slot * ranges.length) return false
  for (let r = 0; r < ranges.length; r++) {
    const at = r * slot
    if (params[at] !== roots || params[at + 1] !== ranges[r].first) return false
    if (params[at + 2] !== ranges[r].count) return false
  }
  return true
}

/** The roots pass's parameters, a uniform slot (`uniformStride`) a range of the cut's worlds: the
 *  roots and the range, written when one of them moved — a frame that composes under the same
 *  ranges sends none. Whether motion is written is the motion mode's (`decideComposedMotion`). */
function writeRootParams(
  device: GPUDevice,
  state: ComposeState,
  gpu: NonNullable<ComposeState['gpu']>,
  ranges: GpuSelection['worldRanges'],
) {
  const slot = uniformStride(device.limits) / 4
  if (paramsHold(state.rootParams, gpu.paramsWritten, ranges, state.roots, slot)) return
  const words = slot * ranges.length
  if (state.rootParams.length < words) state.rootParams = new Uint32Array(words)
  const params = state.rootParams
  if (gpu.uniforms[0].size < words * 4) {
    gpu.uniforms[0].destroy()
    gpu.uniforms[0] = device.createBuffer({
      label: 'Trillion3D compose params',
      size: words * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }
  for (let r = 0; r < ranges.length; r++) {
    const at = r * slot
    params[at] = state.roots
    params[at + 1] = ranges[r].first
    params[at + 2] = ranges[r].count
  }
  device.queue.writeBuffer(gpu.uniforms[0], 0, params, 0, words)
  gpu.paramsWritten = words
}

/** The roots the roots pass composes: the rows of the cut's worlds it writes, which the proxy mirrors. */
function* composedRows(state: ComposeState) {
  for (let rank = 0; rank < state.roots; rank++) if (state.parentOf[rank] !== NONE) yield rank
}

/** The linked roots' cut worlds and motion, before the cut kernel reads them. */
export function encodeComposedRoots(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const state = rt.compose,
    selection = rt.run.gpuSelection,
    gpu = frameParents(rt, device)
  if (!state || !gpu || !selection) return
  // The worlds this pass writes are the ones the cut kernel reads next: no CPU world changed, so
  // no `updateWorlds` saw the turn, and the cut would keep the levels and frustum of the last full
  // write. A frame whose parents moved advances the selection's world revision, as a CPU pose
  // write does, and the dispatch that follows in this command buffer cuts again under them.
  if (state.moving) selection.worldsMovedOnGpu(composedRows(state))
  const motionBuffer = rt.gpu.temporal?.frame.active ? rt.gpu.temporal.motion.buffer : undefined
  // No motion until the temporal pass decides one, later in this frame's encoding.
  state.motionBound = motionBuffer
  state.motionMode[0] = MOTION_SKIP
  device.queue.writeBuffer(gpu.motionMode, 0, state.motionMode)
  const ranges = selection.worldRanges
  writeRootParams(device, state, gpu, ranges)
  const pipeline = composeKernels(device).roots.get()
  const pass = encoder.beginComputePass({ label: COMPOSE_ROOTS_PASS })
  pass.setPipeline(pipeline)
  for (let r = 0; r < ranges.length; r++) {
    const { count, buffer, frames } = ranges[r],
      motion = motionBuffer ?? gpu.noMotion,
      held = (gpu.rootGroups[r] ??= heldGroup()),
      next = held.identity.next
    next[0] = pipeline
    next[1] = gpu.uniforms[0]
    next[2] = gpu.parents
    next[3] = buffer
    next[4] = count
    next[5] = motion
    next[6] = frames
    next[7] = gpu.rootInputs
    next[8] = gpu.rootBoxes
    if (held.identity.moved() || !held.group)
      held.group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: {
              buffer: gpu.uniforms[0],
              offset: r * uniformStride(device.limits),
              size: 16,
            },
          },
          { binding: 1, resource: { buffer: gpu.locals } },
          { binding: 2, resource: { buffer: gpu.parentOf } },
          { binding: 3, resource: { buffer: gpu.parents! } },
          { binding: 4, resource: { buffer, offset: 0, size: count * (64 + WORLD_ORIGIN_BYTES) } },
          { binding: 5, resource: { buffer: motion } },
          { binding: 6, resource: { buffer: gpu.motionMode } },
          { binding: 7, resource: { buffer: gpu.previous } },
          { binding: 8, resource: { buffer: frames, offset: 0, size: count * PRIMITIVE_BYTES } },
          { binding: 9, resource: { buffer: gpu.rootInputs } },
          { binding: 10, resource: { buffer: gpu.rootBoxes } },
        ],
      })
    pass.setBindGroup(0, held.group)
    dispatchRows(pass, ceilDiv(count, 64))
  }
  pass.end()
  rt.run.gpuComputeDispatches += selection.worldRanges.length
}

/** The world words of every page-table row of a linked root, after the CPU rows went up. */
export function encodeComposedRows(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const state = rt.compose,
    table = rt.vis.pageTable,
    gpu = frameParents(rt, device)
  if (!state || !gpu?.parents || !table) return
  const rows = rt.layout.rows.rowCount
  if (!rows) return
  // The parts of a row it derives from the composed world, each when what it writes is made: the
  // shadow cull's spheres while a light casts, the Hi-Z corners with the partition, the shadows'
  // detail with the light that casts.
  const inputs = composedRowInputs(rt, device),
    spheres = linkedRowSpheres(rt),
    corners = rt.vis.gpuPartition?.corners,
    lods = rt.lights.rowLods?.buffer
  if (!inputs) return
  const params = state.rowParams
  params[0] = state.roots
  params[1] = rows
  params[2] = (spheres ? PART_SPHERES : 0) | (corners ? PART_CORNERS : 0) | (lods ? PART_LODS : 0)
  device.queue.writeBuffer(gpu.uniforms[1], 0, params)
  const pipeline = composeKernels(device).rows.get()
  const pass = encoder.beginComputePass({ label: COMPOSE_ROWS_PASS })
  pass.setPipeline(pipeline)
  const held = gpu.rowsGroup,
    next = held.identity.next,
    sphereWorlds = spheres?.buffer ?? gpu.absent[0],
    cornerWords = corners ?? gpu.absent[1],
    lodWords = lods ?? gpu.absent[2]
  next[0] = pipeline
  next[1] = gpu.parents
  next[2] = table
  next[3] = sphereWorlds
  next[4] = inputs.buffer
  next[5] = gpu.rootBoxes
  next[6] = cornerWords
  next[7] = lodWords
  if (held.identity.moved() || !held.group)
    held.group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: gpu.uniforms[1], offset: 0, size: 16 } },
        { binding: 1, resource: { buffer: gpu.locals } },
        { binding: 2, resource: { buffer: gpu.parentOf } },
        { binding: 3, resource: { buffer: gpu.parents } },
        { binding: 4, resource: { buffer: table } },
        { binding: 5, resource: { buffer: sphereWorlds } },
        { binding: 6, resource: { buffer: inputs.buffer } },
        { binding: 7, resource: { buffer: gpu.rootBoxes } },
        { binding: 8, resource: { buffer: cornerWords } },
        { binding: 9, resource: { buffer: lodWords } },
      ],
    })
  pass.setBindGroup(0, held.group)
  // A thread a row, as the roots' above.
  dispatchRows(pass, ceilDiv(rows, 64))
  pass.end()
  rt.run.gpuComputeDispatches++
}
