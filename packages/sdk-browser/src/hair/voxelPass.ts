import { clamp } from '../../../math/src/scalar/reals.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { autoKernel } from '../gpu/core/computeStages.ts'
import { preparedPipelines } from '../gpu/core/preparedPipelines.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import { ensureSet, type HeldSet } from '../gpu/core/heldTextures.ts'
import type { ResourceAllocator } from '../gpu/core/resourceAllocator.ts'
import { wordViews } from '../gpu/core/wordViews.ts'
import { writeChanged } from '../gpu/core/writeChanged.ts'
import { storageBufferCap } from '../session/memory/pools.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import { hairNodeResources, type HairNodes } from './compactionPass.ts'
import type { HairBoundsGpu } from './boundsPass.ts'
import type { HairVoxelSettings } from './inputs.ts'
import { HAIR_AABB_PRECISION_SCALE } from './boundsWgsl.ts'
import { MAX_MACRO_GROUPS, type MacroGroup } from './macroGroups.ts'
import type { DrawnInstance } from './ribbonBinds.ts'
import type { HairInstance } from './scene.ts'
import {
  HAIR_MAX_VOXEL_SIZE,
  HAIR_MIN_VOXEL_SIZE,
  HAIR_VOXEL_ALLOCATE_THREADS,
  HAIR_VOXEL_ARGS_WORDS,
  HAIR_VOXEL_COUNTER_WORDS,
  HAIR_VOXEL_NODE_WORDS,
  HAIR_VOXEL_PARAM_WORDS,
  roundVoxelSize,
  voxelAggregateLevel,
  voxelPageCount,
  voxelPageLevels,
  voxelPageStride,
} from './voxelMath.ts'
import { MIP_ARGS_WGSL, MIP_WGSL } from './voxelMipWgsl.ts'
import { VOXEL_INJECT_WGSL, VOXEL_RASTER_WGSL } from './voxelRasterWgsl.ts'
import {
  ADD_INDIRECT_WGSL,
  ADD_NODE_WGSL,
  ALLOCATE_PAGE_INDEX_WGSL,
  ALLOCATE_PAGES_WGSL,
  CLEAR_PAGES_WGSL,
  FEEDBACK_WGSL,
  MARK_VALID_WGSL,
} from './voxelWgsl.ts'

const kernel = (entry: string, code: string) =>
  autoKernel(`${HAIR_STRANDS_PASS_PREFIX}voxel ${entry}`, code, entry)
const KERNELS = {
  allocatePageIndex: kernel('hairVoxelAllocatePageIndex', ALLOCATE_PAGE_INDEX_WGSL),
  markValid: kernel('hairVoxelMarkValid', MARK_VALID_WGSL),
  allocatePages: kernel('hairVoxelAllocatePages', ALLOCATE_PAGES_WGSL),
  addNode: kernel('hairVoxelAddNode', ADD_NODE_WGSL),
  addIndirect: kernel('hairVoxelAddIndirect', ADD_INDIRECT_WGSL),
  feedback: kernel('hairVoxelFeedback', FEEDBACK_WGSL),
  clearPages: kernel('hairVoxelClearPages', CLEAR_PAGES_WGSL),
  raster: kernel('hairVoxelRaster', VOXEL_RASTER_WGSL),
  inject: kernel('hairVoxelInject', VOXEL_INJECT_WGSL),
  mipArgs: kernel('hairVoxelMipArgs', MIP_ARGS_WGSL),
} as const

/** The kernel that makes the level `target` of the pages: the entry that ends on the level of 4 voxels a side
 *  (`aggregate`) also makes the two below it and, with `patch`, takes the empty pages out of the page index. */
const mipKernels = preparedPipelines(
  ({ target, aggregate, patch }: { target: number; aggregate: boolean; patch: boolean }) =>
    autoKernel(
      `${HAIR_STRANDS_PASS_PREFIX}voxel mip ${target}${aggregate ? ' aggregate' : ''}`,
      MIP_WGSL,
      aggregate ? 'hairVoxelMipAggregate' : 'hairVoxelMip',
      { TARGET: target, PATCH_EMPTY: patch ? 1 : 0 },
    ),
  ({ target, aggregate, patch }) => `${target} ${aggregate} ${patch}`,
)

/** The pipelines of the voxelization, none while one compiles. The passes that find the page index on the
 *  GPU (`gpuDriven`) are asked only then, the injection of the opaque surface only where the settings write
 *  it, and a level's kernel for each level the pages are reduced to. */
function voxelPipelines(device: GPUDevice, settings: HairVoxelSettings) {
  const get = (name: keyof typeof KERNELS) => KERNELS[name](device).get()
  const gpu = settings.gpuDriven
    ? {
        allocatePageIndex: get('allocatePageIndex'),
        markValid: get('markValid'),
        addNode: get('addNode'),
      }
    : undefined
  const common = {
    allocatePages: get('allocatePages'),
    addIndirect: get('addIndirect'),
    feedback: get('feedback'),
    clearPages: get('clearPages'),
    raster: get('raster'),
    mipArgs: get('mipArgs'),
  }
  const inject = settings.injectOpaqueDepth ? get('inject') : undefined
  const last = voxelAggregateLevel(settings.pageResolution)
  const mips = Array.from({ length: last }, (_, k) =>
    mipKernels
      .of({ target: k + 1, aggregate: k + 1 === last, patch: settings.invalidateEmptyPageIndex })(
        device,
      )
      .get(),
  )
  const compiled = (pipelines: object) => Object.values(pipelines).every(Boolean)
  if (
    !compiled(common) ||
    !compiled(mips) ||
    (gpu && !compiled(gpu)) ||
    (settings.injectOpaqueDepth && !inject)
  )
    return undefined
  return {
    ...(common as Record<keyof typeof common, GPUComputePipeline>),
    gpu: gpu as Record<keyof NonNullable<typeof gpu>, GPUComputePipeline> | undefined,
    inject,
    mips: mips as GPUComputePipeline[],
  }
}
type HairVoxelPipelines = NonNullable<ReturnType<typeof voxelPipelines>>

/** The buffers of a volume. `pageCount` pages of `stride` words, a page index of `indexCapacity` entries
 *  shared by the macro groups. */
function allocateVoxels(
  allocator: ResourceAllocator,
  pageCount: number,
  stride: number,
  indexCapacity: number,
  levels: number,
) {
  return {
    alignedAabb: allocator.buffer('aligned bounds', MAX_MACRO_GROUPS * 6, 'storage'),
    pageIndexResolution: allocator.buffer('page index resolution', MAX_MACRO_GROUPS * 4, 'storage'),
    allocationArgs: allocator.buffer('allocation arguments', MAX_MACRO_GROUPS * 3, 'args'),
    pageIndex: allocator.buffer('page index', indexCapacity, 'storage'),
    pageIndexCoord: allocator.buffer('page index coordinates', indexCapacity, 'storage'),
    counter: allocator.buffer('allocated pages', HAIR_VOXEL_COUNTER_WORDS, 'storage'),
    pageToPageIndex: allocator.buffer('page to page index', pageCount, 'storage'),
    nodes: allocator.buffer('nodes', MAX_MACRO_GROUPS * HAIR_VOXEL_NODE_WORDS, 'storage'),
    voxelArgs: allocator.buffer('voxel arguments', HAIR_VOXEL_ARGS_WORDS, 'args'),
    mipArgs: allocator.buffer('level arguments', levels * 3, 'args'),
    voxels: allocator.buffer('voxels', pageCount * stride, 'storage'),
    sizes: [
      allocator.buffer('voxel size a', 1, 'storage'),
      allocator.buffer('voxel size b', 1, 'storage'),
    ] as const,
    paramsBuffer: allocator.buffer('parameters', HAIR_VOXEL_PARAM_WORDS, 'uniform'),
    injectBuffer: allocator.buffer('injection', 4, 'uniform'),
    owners: Array.from({ length: MAX_MACRO_GROUPS }, (_, k) =>
      allocator.buffer(`macro group ${k}`, 4, 'uniform'),
    ),
  }
}

/** A uniform buffer and the words it is written from: `send` copies those that changed. */
interface WordBlock {
  readonly buffer: GPUBuffer
  readonly words: ReturnType<typeof wordViews>
  send(): void
}

const blockOver = (device: GPUDevice, buffer: GPUBuffer, count: number): WordBlock => {
  const words = wordViews(new ArrayBuffer(count * 4))
  return { buffer, words, send: () => writeChanged(device, buffer, words.u, 0, count) }
}

/** What a volume adds to its buffers: the blocks of the image's parameters and of the opaque injection, and
 *  the bind groups made as the passes first need them. */
interface VoxelExtra {
  readonly pageCount: number
  readonly pageStride: number
  readonly pageResolution: number
  readonly indexCapacity: number
  readonly params: WordBlock
  readonly inject: WordBlock
  readonly groups: Record<string, GPUBindGroup>
  /** The depth the injection's group names. */
  injectDepth?: GPUTextureView
}

/** The voxels' parameters, nodes, page index and voxels, then the strands' samples, as binding resources appended to `into`. */
export const voxelSetResources = (
  set: HairVoxelSet,
  nodes: HairNodes,
  into: GPUBindingResource[] = [],
) => {
  into.push(
    { buffer: set.paramsBuffer },
    { buffer: set.nodes },
    { buffer: set.pageIndex },
    { buffer: set.voxels },
  )
  return hairNodeResources(nodes, into)
}

/** The set of a volume. */
export type HairVoxelSet = ReturnType<typeof allocateVoxels> & VoxelExtra & HeldSet

/** What a view keeps of its volume: the set, and which of the two voxel sizes is the last image's. */
export interface HairVoxelState {
  set?: HairVoxelSet
  phase: 0 | 1
  dispose(): void
}

/** A view's volume, none made yet. */
export function createHairVoxelState(): HairVoxelState {
  const state: HairVoxelState = {
    phase: 0,
    dispose() {
      state.set?.dispose()
      state.set = undefined
    },
  }
  return state
}

/** The entries of page index the macro groups need, their boxes cut in pages of a page's width of voxels. */
function pageEntries(
  macroGroups: readonly MacroGroup<HairInstance>[],
  settings: HairVoxelSettings,
  voxelSize: number,
) {
  const pageWorld = voxelSize * settings.pageResolution
  const scale = clamp(settings.aabbScale, 0.01, 10)
  let entries = 0
  for (const { bounds } of macroGroups) {
    const { box } = bounds
    let pages = 1
    for (let axis = 0; axis < 3; axis++)
      pages *= ceilDiv((box[3 + axis]! - box[axis]!) * scale, pageWorld)
    entries += pages
  }
  return entries
}

/** The page index the macro groups need when the GPU finds it: the estimate held to the range the settings
 *  keep. */
const pageIndexEstimate = (
  macroGroups: readonly MacroGroup<HairInstance>[],
  settings: HairVoxelSettings,
  voxelSize: number,
) =>
  clamp(
    pageEntries(macroGroups, settings, voxelSize),
    settings.minPageIndexResolution ** 3,
    settings.maxPageIndexResolution ** 3,
  )

/** The width of the smallest voxel as the passes keep it: the setting, held to the range and rounded. */
const cpuVoxelSize = (settings: HairVoxelSettings) =>
  roundVoxelSize(clamp(settings.worldSize, HAIR_MIN_VOXEL_SIZE, HAIR_MAX_VOXEL_SIZE))

/** Whether the voxel width follows the pages the view needs: the feedback is the GPU's, so the CPU's allocation
 *  keeps the width the settings name. */
const adaptiveOnGpu = (settings: HairVoxelSettings) => settings.adaptive && settings.gpuDriven

/** What `encodeHairVoxels` reads of the image. */
interface HairVoxelFrame {
  readonly settings: HairVoxelSettings
  readonly macroGroups: readonly MacroGroup<HairInstance>[]
  readonly bounds: HairBoundsGpu
  /** The instances to voxelize, each reading its macro group from its block. */
  readonly instances: readonly DrawnInstance[]
  /** The eye, which the macro groups' boxes are carried to the camera's translated world by. */
  readonly eye: ArrayLike<number>
  readonly viewBuffer: GPUBuffer
  readonly depthView: GPUTextureView
  readonly fail: (error: unknown) => void
}

/** The volume of `state` for `settings`, made when it asks for more or other than it holds (a volume the
 *  device's budget refuses is told to `fail`). */
function ensureVoxels(device: GPUDevice, state: HairVoxelState, frame: HairVoxelFrame) {
  const { settings } = frame
  const pageCount = voxelPageCount(
    settings.pageCountPerDim,
    settings.pageResolution,
    storageBufferCap(device.limits),
  )
  const stride = voxelPageStride(settings.pageResolution)
  const size = cpuVoxelSize(settings)
  // The GPU's page index is kept at the greatest the settings name; the CPU's holds what the groups need.
  const ceiling = settings.maxPageIndexResolution ** 3
  const indexCapacity = settings.gpuDriven
    ? ceiling
    : Math.max(ceiling, pageEntries(frame.macroGroups, settings, size))
  const made = ensureSet<ReturnType<typeof allocateVoxels>, VoxelExtra>(
    state.set,
    device,
    {
      key: [settings.pageResolution, pageCount, indexCapacity],
      what: 'the voxels of the hair strands',
      label: `${HAIR_STRANDS_PASS_PREFIX}voxels`,
    },
    (allocator) =>
      allocateVoxels(
        allocator,
        pageCount,
        stride,
        indexCapacity,
        voxelPageLevels(settings.pageResolution),
      ),
    (buffers) => {
      for (const [k, owner] of buffers.owners.entries())
        device.queue.writeBuffer(owner, 0, new Uint32Array([k, 0, 0, 0]))
      for (const buffer of buffers.sizes)
        device.queue.writeBuffer(buffer, 0, new Float32Array([size]))
      return {
        pageCount,
        pageStride: stride,
        pageResolution: settings.pageResolution,
        indexCapacity,
        params: blockOver(device, buffers.paramsBuffer, HAIR_VOXEL_PARAM_WORDS),
        inject: blockOver(device, buffers.injectBuffer, 4),
        groups: {},
      }
    },
  )
  if (!made.resources) {
    frame.fail(new Error(`the hair voxels cannot be made: ${made.why ?? 'no room'}`))
    return undefined
  }
  state.set = made.resources
  return state.set
}

/** Writes the image's parameters into the set's block; `indexEntries` is the room of the page index the groups
 *  share. */
function writeParams(set: HairVoxelSet, frame: HairVoxelFrame, indexEntries: number) {
  const { settings, macroGroups, bounds } = frame
  const size = cpuVoxelSize(settings)
  const { u, f } = set.params.words
  let support = 0
  macroGroups.forEach((group, rank) => {
    if (group.supportsVoxelization) support |= 1 << rank
  })
  f[0] = size * settings.pageResolution
  f[1] = size
  u[2] = adaptiveOnGpu(settings) ? 0 : 1
  u[3] = indexEntries
  u[4] = settings.pageResolution
  u[5] = macroGroups.length
  u[6] = support
  u[7] = set.pageCount
  u[8] = set.pageStride
  f[9] = clamp(settings.correctionThreshold, 0, 1)
  f[10] = clamp(settings.correctionSpeed, 0, 1)
  u[11] = set.pageCount
  f[12] = HAIR_MIN_VOXEL_SIZE
  f[13] = HAIR_MAX_VOXEL_SIZE
  u[14] = bounds.update.entryCount
  u[15] = bounds.update.registeredCount
  set.params.send()
  const injection = set.inject.words.u
  injection[0] = settings.biasCount
  injection[1] = settings.markCount
  set.inject.send()
}

/** A voxel's width on the eleven bits of the node (`packVoxelSize`). */
const packVoxelSize = (size: number) => Math.floor(clamp(size / HAIR_MAX_VOXEL_SIZE, 0, 1) * 2047)

const cpuAllocated = new Int32Array(MAX_MACRO_GROUPS * 6)
const cpuResolution = new Uint32Array(MAX_MACRO_GROUPS * 4)
const cpuArgs = new Uint32Array(MAX_MACRO_GROUPS * 3)
const cpuNodes = new Uint32Array(MAX_MACRO_GROUPS * HAIR_VOXEL_NODE_WORDS)
const cpuNodeFloats = new Float32Array(cpuNodes.buffer)
let cpuPages = new Uint32Array(0)

/**
 * The allocation of the page index by the CPU (the reference's allocation when it is not driven by the GPU):
 * each macro group's box is carried to the camera's translated world and scaled about its centre, cut in
 * pages of a page's width of voxels at the least width the settings name (the box's far corner snapped to
 * whole pages), and given the next entries of the page index where the index has room for it; every page of
 * a group is taken as touched. What the GPU passes would write is written here: the snapped boxes, the
 * groups' resolutions and offsets, the dispatches over their pages and their nodes; and the marks of the
 * page index. Returns the entries the groups take.
 */
function allocateOnCpu(device: GPUDevice, set: HairVoxelSet, frame: HairVoxelFrame) {
  const { settings, macroGroups, eye } = frame
  const size = cpuVoxelSize(settings)
  const pageWorld = size * settings.pageResolution
  const scale = clamp(settings.aabbScale, 0.01, 10)
  const room = set.indexCapacity
  cpuAllocated.fill(0)
  cpuResolution.fill(0)
  cpuArgs.fill(0)
  cpuNodes.fill(0)
  let offset = 0
  let fits = true
  macroGroups.forEach((group, rank) => {
    if (!group.supportsVoxelization) {
      cpuArgs[rank * 3 + 1] = 1
      cpuArgs[rank * 3 + 2] = 1
      return
    }
    const { box } = group.bounds
    const lo: [number, number, number] = [0, 0, 0],
      hi: [number, number, number] = [0, 0, 0],
      pages: [number, number, number] = [0, 0, 0]
    for (let axis = 0; axis < 3; axis++) {
      const centre = (box[axis]! + box[3 + axis]!) * 0.5
      lo[axis] = (box[axis]! - centre) * scale + centre - eye[axis]!
      hi[axis] = (box[3 + axis]! - centre) * scale + centre - eye[axis]!
      pages[axis] = ceilDiv(hi[axis]! - lo[axis]!, pageWorld)
    }
    const count = pages[0] * pages[1] * pages[2]
    fits &&= offset + count <= room
    cpuArgs[rank * 3 + 1] = 1
    cpuArgs[rank * 3 + 2] = 1
    if (!fits || count === 0) return
    for (let axis = 0; axis < 3; axis++) hi[axis] = pages[axis]! * pageWorld + lo[axis]!
    for (let axis = 0; axis < 3; axis++) {
      cpuAllocated[rank * 6 + axis] = Math.trunc(lo[axis]! * HAIR_AABB_PRECISION_SCALE)
      cpuAllocated[rank * 6 + 3 + axis] = Math.trunc(hi[axis]! * HAIR_AABB_PRECISION_SCALE)
    }
    cpuResolution.set([pages[0], pages[1], pages[2], offset], rank * 4)
    cpuArgs[rank * 3] = ceilDiv(count, HAIR_VOXEL_ALLOCATE_THREADS)
    const at = rank * HAIR_VOXEL_NODE_WORDS
    cpuNodeFloats.set(lo, at)
    cpuNodes[at + 3] = (pages[0] & 0xff) | ((pages[1] & 0xff) << 8) | ((pages[2] & 0xff) << 16)
    cpuNodeFloats.set(hi, at + 4)
    cpuNodes[at + 7] = (offset & 0x1fffff) | (packVoxelSize(size) << 21)
    offset += count
  })
  if (cpuPages.length < offset) cpuPages = new Uint32Array(offset)
  cpuPages.fill(1, 0, offset)
  device.queue.writeBuffer(set.alignedAabb, 0, cpuAllocated)
  device.queue.writeBuffer(set.pageIndexResolution, 0, cpuResolution)
  device.queue.writeBuffer(set.allocationArgs, 0, cpuArgs)
  device.queue.writeBuffer(set.nodes, 0, cpuNodes)
  if (offset > 0) device.queue.writeBuffer(set.pageIndex, 0, cpuPages, 0, offset)
  return offset
}

/** What the passes of a voxelization share: its compute pass, the set, the frame and the binding of a group by name. */
interface VoxelRun {
  readonly pass: GPUComputePassEncoder
  readonly set: HairVoxelSet
  readonly frame: HairVoxelFrame
  readonly pipelines: HairVoxelPipelines
  readonly phase: 0 | 1
  readonly params: GPUBindingResource
  readonly bind: (
    name: string,
    pipeline: GPUComputePipeline,
    resources: readonly GPUBindingResource[],
    group?: number,
  ) => GPUBindGroup
}

const buffer = (b: GPUBuffer): GPUBindingResource => ({ buffer: b })

/** The GPU's allocation: the page index of each macro group sized, its pages marked valid, its node added. */
function encodeGpuAllocation(
  { pass, set, frame, phase, params, bind }: VoxelRun,
  gpu: NonNullable<HairVoxelPipelines['gpu']>,
) {
  const { bounds } = frame
  const current = set.sizes[phase]
  pass.setPipeline(gpu.allocatePageIndex)
  pass.setBindGroup(
    0,
    bind(`allocatePageIndex${phase}`, gpu.allocatePageIndex, [
      params,
      buffer(bounds.macroAabb),
      buffer(bounds.macroVoxelSize),
      buffer(current),
      buffer(set.alignedAabb),
      buffer(set.pageIndexResolution),
      buffer(set.allocationArgs),
    ]),
  )
  pass.dispatchWorkgroups(1)

  if (bounds.update.registeredCount > 0) {
    pass.setPipeline(gpu.markValid)
    pass.setBindGroup(
      0,
      bind('markValid', gpu.markValid, [
        params,
        buffer(bounds.groupAabb),
        buffer(set.alignedAabb),
        buffer(set.pageIndexResolution),
        buffer(set.pageIndex),
        buffer(bounds.entries),
        buffer(bounds.registered),
      ]),
    )
    pass.dispatchWorkgroups(bounds.update.registeredCount)
  }

  pass.setPipeline(gpu.addNode)
  pass.setBindGroup(
    0,
    bind(`addNode${phase}`, gpu.addNode, [
      params,
      buffer(set.alignedAabb),
      buffer(bounds.macroVoxelSize),
      buffer(set.pageIndexResolution),
      buffer(current),
      buffer(set.nodes),
    ]),
  )
  pass.dispatchWorkgroups(1)
}

/** The pages each macro group's instances touch allocated, the dispatches over them made, the voxel size of the next image fed back, the first level cleared. */
function encodePages({ pass, set, frame, pipelines, phase, params, bind }: VoxelRun) {
  const { macroGroups } = frame
  pass.setPipeline(pipelines.allocatePages)
  for (let owner = 0; owner < macroGroups.length; owner++) {
    if (!macroGroups[owner]!.supportsVoxelization) continue
    pass.setBindGroup(
      0,
      bind(`allocatePages${owner}`, pipelines.allocatePages, [
        params,
        buffer(set.pageIndexResolution),
        buffer(set.pageIndex),
        buffer(set.counter),
        buffer(set.pageToPageIndex),
        buffer(set.pageIndexCoord),
        buffer(set.owners[owner]!),
      ]),
    )
    pass.dispatchWorkgroupsIndirect(set.allocationArgs, owner * 12)
  }

  pass.setPipeline(pipelines.addIndirect)
  pass.setBindGroup(
    0,
    bind('addIndirect', pipelines.addIndirect, [
      params,
      buffer(set.counter),
      buffer(set.voxelArgs),
    ]),
  )
  pass.dispatchWorkgroups(1)

  if (adaptiveOnGpu(frame.settings)) {
    pass.setPipeline(pipelines.feedback)
    pass.setBindGroup(
      0,
      bind(`feedback${phase}`, pipelines.feedback, [
        params,
        buffer(set.counter),
        buffer(set.sizes[phase]),
        buffer(set.sizes[(1 - phase) as 0 | 1]),
      ]),
    )
    pass.dispatchWorkgroups(1)
  }

  pass.setPipeline(pipelines.clearPages)
  pass.setBindGroup(
    0,
    bind('clearPages', pipelines.clearPages, [params, buffer(set.counter), buffer(set.voxels)]),
  )
  pass.dispatchWorkgroupsIndirect(set.voxelArgs, 0)
}

/** Every segment of every instance stepped into the voxels it crosses. */
function encodeRaster({ pass, set, frame, pipelines, params, bind }: VoxelRun) {
  pass.setPipeline(pipelines.raster)
  pass.setBindGroup(
    1,
    bind(
      'raster',
      pipelines.raster,
      [
        buffer(frame.viewBuffer),
        buffer(set.nodes),
        buffer(set.pageIndex),
        buffer(set.voxels),
        params,
      ],
      1,
    ),
  )
  for (const instance of frame.instances) {
    pass.setBindGroup(0, instance.group(pipelines.raster))
    dispatchRows(pass, ceilDiv(instance.pointCount, WORKGROUP_THREADS))
  }
}

/** The opaque surface marked in the voxels behind it. */
function encodeInject({ pass, set, frame, params, bind }: VoxelRun, inject: GPUComputePipeline) {
  const { macroGroups } = frame
  pass.setPipeline(inject)
  if (set.injectDepth !== frame.depthView) {
    for (const name of Object.keys(set.groups))
      if (name.startsWith('inject')) delete set.groups[name]
    set.injectDepth = frame.depthView
  }
  for (let owner = 0; owner < macroGroups.length; owner++) {
    if (!macroGroups[owner]!.supportsVoxelization) continue
    pass.setBindGroup(
      0,
      bind(`inject${owner}`, inject, [
        params,
        buffer(set.nodes),
        buffer(set.pageIndex),
        buffer(set.pageIndexCoord),
        buffer(set.counter),
        buffer(set.voxels),
        frame.depthView,
        buffer(frame.viewBuffer),
        buffer(set.owners[owner]!),
        buffer(set.inject.buffer),
      ]),
    )
    pass.dispatchWorkgroupsIndirect(set.voxelArgs, (1 + owner) * 12)
  }
}

/** The levels: the dispatches over the pages for each, then each level from the one below it. */
function encodeMips({ pass, set, pipelines, params, bind }: VoxelRun) {
  pass.setPipeline(pipelines.mipArgs)
  pass.setBindGroup(
    0,
    bind('mipArgs', pipelines.mipArgs, [params, buffer(set.voxelArgs), buffer(set.mipArgs)]),
  )
  pass.dispatchWorkgroups(1)
  const last = pipelines.mips.length
  pipelines.mips.forEach((pipeline, k) => {
    const aggregate = k + 1 === last
    pass.setPipeline(pipeline)
    pass.setBindGroup(
      0,
      bind(
        `mip${k + 1}`,
        pipeline,
        aggregate
          ? [
              params,
              buffer(set.counter),
              buffer(set.voxels),
              buffer(set.pageToPageIndex),
              buffer(set.pageIndex),
            ]
          : [params, buffer(set.counter), buffer(set.voxels)],
      ),
    )
    pass.dispatchWorkgroupsIndirect(set.mipArgs, (k + 1) * 12)
  })
}

/**
 * Voxelizes the strands of the macro groups of an image on `encoder`, in the reference's order: the page
 * index of each macro group (its box cut in pages), the pages the instances touch marked, each group's node,
 * the marked pages allocated (a dispatch a group), the dispatches over the allocated pages, the voxel size
 * for the next image (where the allocation is adaptive); then the first level of the allocated pages
 * cleared, every segment of every instance stepped into the voxels it crosses, where the settings write it
 * the opaque surface marked in the voxels behind it, and the levels of the pages made from the first.
 * Where the allocation is the CPU's (`gpuDriven` off) the page index is written by the CPU. Returns the
 * volume, none while a program compiles, no macro group voxelizes or the volume cannot be made.
 */
export function encodeHairVoxels(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: HairVoxelState,
  frame: HairVoxelFrame,
): HairVoxelSet | undefined {
  const { settings, macroGroups, bounds } = frame
  if (!macroGroups.some((group) => group.supportsVoxelization) || bounds.update.entryCount === 0)
    return undefined
  const pipelines = voxelPipelines(device, settings)
  if (!pipelines) return undefined
  const set = ensureVoxels(device, state, frame)
  if (!set) return undefined
  const size = cpuVoxelSize(settings)
  const indexEntries = settings.gpuDriven
    ? pageIndexEstimate(macroGroups, settings, size)
    : allocateOnCpu(device, set, frame)
  writeParams(set, frame, indexEntries)
  const phase = state.phase
  // The CPU's allocation writes the page index whole, which the clear would take back.
  if (settings.gpuDriven) encoder.clearBuffer(set.pageIndex)
  encoder.clearBuffer(set.counter)
  const run: VoxelRun = {
    pass: encoder.beginComputePass({ label: `${HAIR_STRANDS_PASS_PREFIX}voxelization` }),
    set,
    frame,
    pipelines,
    phase,
    params: buffer(set.params.buffer),
    bind: (name, pipeline, resources, group = 0) =>
      (set.groups[name] ??= device.createBindGroup({
        layout: pipeline.getBindGroupLayout(group),
        entries: sequentialEntries(resources),
      })),
  }
  if (pipelines.gpu) encodeGpuAllocation(run, pipelines.gpu)
  encodePages(run)
  encodeRaster(run)
  if (pipelines.inject) encodeInject(run, pipelines.inject)
  encodeMips(run)
  run.pass.end()
  if (adaptiveOnGpu(settings)) state.phase = (1 - phase) as 0 | 1
  return set
}
