/**
 * PLACEMENTS COMPOSED ON THE GPU UNDER A MOVED PARENT.
 *
 * A row of an instance buffer whose mesh only follows its parent is linked once: the mesh's own
 * local matrix and the parent's slot. From then on a parent that moves sends one matrix; two
 * compute passes write, for every linked root, `parent · local` in exact double arithmetic
 * (`gpuComposeWgsl.ts`) into the cut's worlds, brought to the eye (`gpu/dag/frameRanges.ts`), and
 * the temporal motion, and into the world words of every page-table row of that root: the very
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
 * CPU motion's own write is: every reader of the motion, the reflections' history included, sees it.
 *
 * The shadows follow a parent's move as they follow a moved node's (`movedBatch.ts`): the box of
 * the slot's linked roots in the parent's frame (`slotBoxes`, the union of each root's local box
 * through its local matrix, made when the links change) is declared at the parent's last world and
 * at its new one, each on its own, the second only when it differs — one box per moved parent, at
 * most two per move, never a row. Its first move makes its roots moving casters, once
 * (`mobility.moveLead`); a later move stales the moving casters alone. The rows pass writes each
 * linked row's world sphere, what the shadow cull drops a row by, from its composed world.
 *
 * Still derived at the last full write, not on the GPU yet: the primitive stretch, the corners and
 * world boxes, the shadow levels of detail. A link made with the rows' own CPU write changes none
 * of these: the CPU's row write follows them.
 */
import { COMPOSE_ROOTS_WGSL, COMPOSE_ROWS_WGSL, MATRIX_DOUBLES, NONE } from './gpuComposeWgsl.ts'
import { MOTION_SKIP, packDoubles } from './composedMotion.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { preparedComputePipeline } from '../lighting/deferred/fullscreen.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { GpuSelection } from '../gpu/core/selection.ts'
import { placedBy, type PlacementRows } from './rows.ts'
import { MOVE_PROMOTED, rootRankOfRow } from './update.ts'
import { BOX_VALUES } from '../../../sdk-core/src/index.ts'
import { WORLD_ORIGIN_BYTES } from '../gpu/dag/worldOrigins.ts'
import { linkedRowSpheres } from '../webgpu/shadow/spheres.ts'
import { sameElements } from '../math/matrixElements.ts'
import { declareSlotMove, holdSlotBox, linkBox, remakeSlotBox } from './composeBoxes.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'

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
    packed: new Uint32Array(MATRIX_DOUBLES * 2),
    /** The roots pass's parameters, 64 words a range of the cut's worlds; the rows pass's four. */
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
    /** The eye the cut's worlds are brought to (`worldUploadOrigin`). */
    eye: new Float64Array(3),
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

function grown(array: Float64Array<ArrayBuffer>, length: number) {
  if (array.length >= length) return array
  const next = new Float64Array(length * 2)
  next.set(array)
  return next
}

/**
 * Takes `world` as `parent`'s world and links `links` to it. `whole`: they are every row that
 * follows it, any other root it linked follows none any more — no link at all frees its slot —;
 * otherwise they are rows it holds, at a new local matrix. False when a link names a row this
 * session does not read through a root, or that a blended copy reads, or when only some rows are
 * given of a parent it holds no link of: the caller writes the rows itself.
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
  if (p === undefined && (!whole || !links.length)) return false
  const ranks = linkedRanks(rt, links)
  if (!ranks) return false
  const slot = takeSlot(state, parent, p, world)
  // The shadow pages the slot's roots cover at the parent's last world: a slot linked now has
  // none of its own, its rows' CPU write in this call declares them (`webgpuPlacements.ts`). The
  // static casters under it stay unless a root it changes is still or its parent's move is a first.
  let movingOnly = true
  holdSlotBox(state, p)
  for (const rank of ranks) movingOnly &&= mobility.moves(rank)
  if (whole) movingOnly = unlinkHeld(rt, state, slot, ranks) && movingOnly
  if (!ranks.length && whole) {
    state.parentIds.delete(parent)
    state.freeSlots.push(slot)
    declareSlotMove(rt, state, undefined, movingOnly)
    return true
  }
  linkRanks(rt, state, { slot, ranks, links, whole })
  const relinked = ranks.length > 0 || whole
  if (relinked) remakeSlotBox(state, slot)
  settleSlot(rt, state, { slot, p, world, relinked, movingOnly })
  // Poses moved and no node entered or left: the frame hears it as any engine pose write.
  rt.run.gate.engineMovedInPlace()
  return true
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
  // A parent's move moves its roots: its first makes them moving casters (`mobility.moveLead`).
  if (moved && rt.lights.mobility.moveLead(slot, state.ranksOf[slot]) === MOVE_PROMOTED)
    movingOnly = false
  if (p !== undefined && (moved || relinked)) declareSlotMove(rt, state, slot, movingOnly)
}

/** The session's composition, made again for another root list: the roots it linked follow
 *  none any more. */
function composeState(rt: WebgpuPagesRuntime) {
  const roots = rt.layout.selectionRoots
  if (rt.compose && rt.compose.roots !== roots.length) {
    const { parentOf } = rt.compose
    for (let rank = 0; rank < rt.compose.roots; rank++)
      if (parentOf[rank] !== NONE) rt.lights.mobility.follow(rank, -1)
    rt.compose.gpu?.dispose()
    rt.compose = undefined
  }
  return (rt.compose ??= createComposeState(roots.length))
}

/** The root rank of each link, or undefined when one names a row no root reads or a blended copy
 *  reads: the caller writes the rows itself. */
function linkedRanks(rt: WebgpuPagesRuntime, links: readonly PlacementLink[]) {
  const ranks: number[] = []
  for (const link of links) {
    if (placedBy(rt.blendState.blendGpu, link.rows)) return undefined
    const rank = rootRankOfRow(rt.layout.selectionRoots, link.rows, link.index)
    if (rank < 0) return undefined
    ranks.push(rank)
  }
  return ranks
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
  state.worlds = grown(state.worlds, state.slots * 16)
  state.previous = grown(state.previous, state.slots * 16)
  state.slotBoxes = grown(state.slotBoxes, state.slots * BOX_VALUES)
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
    state.parentOf[rank] = NONE
    mobility.follow(rank, -1)
    rt.run.gpuSelection?.composedPlacement?.(rank, false)
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
  for (let k = 0; k < ranks.length; k++) {
    const rank = ranks[k],
      was = state.parentOf[rank]
    if (whole || was !== slot) held.push(rank)
    // A root linked now starts its motion from the pose the CPU motion last accumulated it at, the
    // one `../taa/motion.ts` would compare its next world with; a root linked already keeps its own.
    if (was === NONE)
      state.seeds.set(
        rank,
        Float32Array.from(rt.gpu.temporal?.motion.poseOf(rank) ?? roots[rank].world.elements),
      )
    state.parentOf[rank] = slot
    rt.lights.mobility.follow(rank, slot)
    rt.run.gpuSelection?.composedPlacement?.(rank, true)
    packDoubles(state.locals, rank * MATRIX_DOUBLES * 2, links[k].local)
    linkBox(state, rank, roots[rank], links[k].local)
  }
  if (ranks.length) state.linksDirty = true
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
      size: 256 * 8,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  )
  const noMotion = device.createBuffer({ label: 'Trillion3D no motion', size: 64, usage: storage })
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
    parents: undefined as GPUBuffer | undefined,
    uniforms,
    noMotion,
    previous,
    motionMode,
    /** The roots pass's group of each range of the cut's worlds, and the rows pass's. */
    rootGroups: [] as HeldGroup[],
    rowsGroup: heldGroup(),
    dispose() {
      locals.destroy()
      parentOf.destroy()
      this.parents?.destroy()
      for (const u of uniforms) u.destroy()
      noMotion.destroy()
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

/** `cut` told every root a parent composes on the GPU now, read off the one compose state: its
 *  tree group opens there as in the cut it replaces (`composedPlacement`) — a link or an unlink
 *  made while it was being made included. */
export function replayComposed(rt: WebgpuPagesRuntime, cut: GpuSelection) {
  const parentOf = rt.compose?.parentOf
  if (!parentOf || !cut.composedPlacement) return
  for (let rank = 0; rank < parentOf.length; rank++)
    if (parentOf[rank] !== NONE) cut.composedPlacement(rank, true)
}

/** Asks the kernels the next frame binds once a parent holds a link
 *  (`../webgpu/frame/framePipelines.ts`); nothing while none does. */
export function askComposedPlacements(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!rt.compose?.parentIds.size) return
  const kernels = composeKernels(device)
  kernels.roots.ask()
  kernels.rows.ask()
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
    device.queue.writeBuffer(gpu.locals, 0, state.locals)
    device.queue.writeBuffer(gpu.parentOf, 0, state.parentOf)
    state.linksDirty = false
  }
  for (const [rank, pose] of state.seeds) device.queue.writeBuffer(gpu.previous, rank * 64, pose)
  state.seeds.clear()
  state.eye.set(rt.run.worldUploadOrigin)
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

/** The roots pass's parameters, 64 words a range of the cut's worlds: the roots, the range, whether
 *  motion is written, the eye. */
function writeRootParams(
  device: GPUDevice,
  state: ComposeState,
  gpu: NonNullable<ComposeState['gpu']>,
  ranges: GpuSelection['worldRanges'],
  motion: boolean,
) {
  const words = 64 * ranges.length
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
    const at = r * 64
    params[at] = state.roots
    params[at + 1] = ranges[r].first
    params[at + 2] = ranges[r].count
    params[at + 3] = motion ? 1 : 0
    packDoubles(params, at + 4, state.eye)
  }
  device.queue.writeBuffer(gpu.uniforms[0], 0, params, 0, words)
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
  if (state.moving) selection.worldsMovedOnGpu()
  const motionBuffer = rt.gpu.temporal?.frame.active ? rt.gpu.temporal.motion.buffer : undefined
  // No motion until the temporal pass decides one, later in this frame's encoding.
  state.motionBound = motionBuffer
  state.motionMode[0] = MOTION_SKIP
  device.queue.writeBuffer(gpu.motionMode, 0, state.motionMode)
  const ranges = selection.worldRanges
  writeRootParams(device, state, gpu, ranges, !!motionBuffer)
  const pipeline = composeKernels(device).roots.get()
  const pass = encoder.beginComputePass({ label: 'Trillion3D compose roots' })
  pass.setPipeline(pipeline)
  for (let r = 0; r < ranges.length; r++) {
    const { count, buffer } = ranges[r],
      motion = motionBuffer ?? gpu.noMotion,
      held = (gpu.rootGroups[r] ??= heldGroup()),
      next = held.identity.next
    next[0] = pipeline
    next[1] = gpu.uniforms[0]
    next[2] = gpu.parents
    next[3] = buffer
    next[4] = count
    next[5] = motion
    if (held.identity.moved() || !held.group)
      held.group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: gpu.uniforms[0], offset: r * 256, size: 48 } },
          { binding: 1, resource: { buffer: gpu.locals } },
          { binding: 2, resource: { buffer: gpu.parentOf } },
          { binding: 3, resource: { buffer: gpu.parents! } },
          { binding: 4, resource: { buffer, offset: 0, size: count * (64 + WORLD_ORIGIN_BYTES) } },
          { binding: 5, resource: { buffer: motion } },
          { binding: 6, resource: { buffer: gpu.motionMode } },
          { binding: 7, resource: { buffer: gpu.previous } },
        ],
      })
    pass.setBindGroup(0, held.group)
    pass.dispatchWorkgroups(Math.ceil(count / 64))
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
  // The shadow cull's spheres while a light casts, and the local boxes they are made from.
  const spheres = linkedRowSpheres(rt, device),
    params = state.rowParams
  params[0] = state.roots
  params[1] = rows
  params[2] = spheres ? 1 : 0
  device.queue.writeBuffer(gpu.uniforms[1], 0, params)
  const pipeline = composeKernels(device).rows.get()
  const pass = encoder.beginComputePass({ label: 'Trillion3D compose rows' })
  pass.setPipeline(pipeline)
  const held = gpu.rowsGroup,
    next = held.identity.next,
    sphereWorlds = spheres?.buffer ?? gpu.noMotion,
    sphereLocals = spheres?.local ?? gpu.locals
  next[0] = pipeline
  next[1] = gpu.parents
  next[2] = table
  next[3] = sphereWorlds
  next[4] = sphereLocals
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
        { binding: 6, resource: { buffer: sphereLocals } },
      ],
    })
  pass.setBindGroup(0, held.group)
  pass.dispatchWorkgroups(Math.ceil(rows / 64))
  pass.end()
  rt.run.gpuComputeDispatches++
}
