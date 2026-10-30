import { retire } from '../../../gpu/core/frameRetire.ts'
import { keptOrMade } from '../../../gpu/core/keptOrMade.ts'
import { gpuAllocator } from '../../../gpu/core/resourceAllocator.ts'
import type { HitLightingSettings } from '../../../../../sdk-core/src/contracts/hitLightingOptions.ts'
import { hitLightWord, LIT_SINGLE_VECS } from './constants.ts'

/** The mode word the hits of a host whose paths bounce once are lit with (`hitLightWord`): the settings' lights and shadows, the one bounce, no refraction event and no reflection capture of the host's rays. */
export const singleBounceLightWord = (hit: HitLightingSettings) =>
  hitLightWord({ ...hit, bounces: 1, refractions: 0, captures: false })

/** The byte offset of the passes' dispatch arguments in `args` (the sort's are the first three words). */
const PASS_ARGS = 12

/**
 * WHAT THE HIT LIGHTING OF A HOST WHOSE PATHS BOUNCE ONCE KEEPS (the screen probes', the radiance cache's): the list of the hits to light (its count first) and its sorted copy, the arguments of the passes over it, and the first pass's radiance, each sized for
 * `capacity` rays.
 */
export interface LitListResources {
  /** The rays the buffers are made for. */
  readonly capacity: number
  /** The images in a row that asked at most a quarter of the capacity (`keptOrMade`). */
  small: number
  readonly list: GPUBuffer
  readonly sorted: GPUBuffer
  readonly args: GPUBuffer
  readonly radiance: GPUBuffer
  /** Bytes the buffers hold. */
  readonly bytes: number
  dispose(): void
}

/** The bytes of the first pass's radiance for `rays` rays. */
const litRadianceBytesOf = (rays: number) => rays * LIT_SINGLE_VECS * 16

/** The most rays whose radiance fits one storage binding of the device. */
export const litMostRays = (device: GPUDevice) =>
  Math.floor(
    Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize) /
      (LIT_SINGLE_VECS * 16),
  )

/** The resources for `rays` rays, in an allocator of the name `label` the host gives back with `dispose`. */
export function createLitListResources(
  device: GPUDevice,
  label: string,
  rays: number,
): LitListResources {
  const a = gpuAllocator(device, label)
  return {
    capacity: rays,
    small: 0,
    list: a.buffer('list', 2 + 2 * rays, 'storage'),
    sorted: a.buffer('sorted', 2 * rays, 'storage'),
    args: a.buffer('arguments', 6, 'args'),
    radiance: a.buffer('radiance', litRadianceBytesOf(rays) / 4, 'storage'),
    bytes: a.bytes(),
    dispose: () => retire(device, a),
  }
}

/**
 * The resources for `rays` rays where the device's budget leaves room (`ledgerAdmitted`, the held ones' bytes credited): the `held` ones where they are made for as many and the images in a row that asked at most a quarter of them have not reached the shrinking
 * count (`keptOrMade`, as the radiance cache keeps its trace atlas), else new ones and the held retired; none where the budget refuses them, the host then lights its hits from the cards. The held ones are given back whichever answers.
 */
export function admitLitListResources(
  device: GPUDevice,
  held: LitListResources | undefined,
  label: string,
  rays: number,
): LitListResources | undefined {
  const { atlas, small } = keptOrMade(
    device,
    held,
    {
      holds: held !== undefined && held.capacity >= rays,
      small: held?.small ?? 0,
      asked: rays,
      texels: held?.capacity ?? 0,
      // A refused shrink keeps the lists that work (a grow does not: they cannot serve the ask).
      keepOnRefusal: held !== undefined && held.capacity >= rays,
    },
    {
      asked: (2 + 2 * rays + 2 * rays + 6) * 4 + litRadianceBytesOf(rays),
      what: 'the hit lighting’s lists',
      make: () => createLitListResources(device, label, rays),
    },
  )
  if (atlas) atlas.small = small
  return atlas
}

/** The bind groups of one image's hit lighting: the compaction, the list's passes, the first pass with the scene trace's group, the second. */
export interface LitListGroups {
  compact: GPUBindGroup
  dispatch: GPUBindGroup
  copy: GPUBindGroup
  sortArgs: GPUBindGroup
  sort: GPUBindGroup
  direct: GPUBindGroup
  scene: GPUBindGroup
  finish: GPUBindGroup
  /** The group the second pass binds at the scene trace's index where it is not the first pass's (the reflections' second pass reads the trace's parameters alone). */
  finishScene?: GPUBindGroup
}

/** The pipelines of the passes (read once the host's kernels are ready), the list's ones being the reflections' (`litListStages`). */
export interface LitListKernels {
  /** The emptying of the list's count by a pass, for a host whose list is filled again inside one compute pass. */
  readonly reset?: GPUComputePipeline
  readonly compact: GPUComputePipeline
  readonly list: {
    readonly dispatch: GPUComputePipeline
    readonly copy: GPUComputePipeline
    readonly sortArgs: GPUComputePipeline
    readonly sort: GPUComputePipeline
  }
  readonly direct: GPUComputePipeline
  readonly finish: GPUComputePipeline
}

/** What the passes over a list read of the resources that hold it: the arguments of their dispatches. */
export type LitListArgs = Pick<LitListResources, 'args'>

/** The hit lighting of an image: its kernels, its resources and its groups, the group the scene trace takes in the first pass, and whether the hits are sorted by material. */
export interface LitListRun<
  K extends LitListKernels = LitListKernels,
  R extends LitListArgs = LitListResources,
> {
  kernels: K
  resources: R
  groups: LitListGroups
  readonly sceneGroup: number
  bucket: boolean
  /** The group of the host's own view that the passes read beside the scene trace's, with the bind group each pass sets there (the reflections'). */
  view?: { readonly index: number; direct: GPUBindGroup; finish: GPUBindGroup }
}

/** The one run a host's binder keeps (`LitListRun`), written over each image: nothing is allocated an image. */
export function litRunBinder<K extends LitListKernels, R extends LitListArgs = LitListResources>(
  sceneGroup: number,
) {
  let run: LitListRun<K, R> | undefined
  return (kernels: K, resources: R, groups: LitListGroups, bucket: boolean) => {
    if (!run) return (run = { kernels, resources, groups, sceneGroup, bucket })
    run.kernels = kernels
    run.resources = resources
    run.groups = groups
    run.bucket = bucket
    return run
  }
}

/**
 * THE HIT LIGHTING OF A LIST in the open compute pass `pass`, after the stage that cast the rays marked their hits: the marks are collected into a list (`rays` the buffer the compaction is dispatched over indirectly, from its first word) emptied first where the host's
 * kernels empty it themselves (`reset`), sorted by the material of their hit (the reflections' sort) or handed on as they are, lit where they stand (the first pass: the material, the lights and their shadow rays) and finished (the second: the cache's indirect light,
 * the leaking sky light, the fog, the host's radiance). The groups the passes share with the pass (the host's own) are set by the caller, those of `run.view` and the second pass's scene group apart.
 */
export function encodeLitList(
  pass: GPUComputePassEncoder,
  run: LitListRun<LitListKernels, LitListArgs>,
  rays: GPUBuffer,
) {
  const { kernels, groups, resources } = run
  if (kernels.reset) {
    pass.setPipeline(kernels.reset)
    pass.setBindGroup(0, groups.compact)
    pass.dispatchWorkgroups(1)
  }
  pass.setPipeline(kernels.compact)
  pass.setBindGroup(0, groups.compact)
  pass.dispatchWorkgroupsIndirect(rays, 0)
  pass.setPipeline(kernels.list.dispatch)
  pass.setBindGroup(0, groups.dispatch)
  pass.dispatchWorkgroups(1)
  if (run.bucket) {
    pass.setPipeline(kernels.list.sortArgs)
    pass.setBindGroup(0, groups.sortArgs)
    pass.dispatchWorkgroups(1)
    pass.setPipeline(kernels.list.sort)
    pass.setBindGroup(0, groups.sort)
    pass.dispatchWorkgroupsIndirect(resources.args, 0)
  } else {
    pass.setPipeline(kernels.list.copy)
    pass.setBindGroup(0, groups.copy)
    pass.dispatchWorkgroupsIndirect(resources.args, PASS_ARGS)
  }
  pass.setPipeline(kernels.direct)
  pass.setBindGroup(0, groups.direct)
  if (run.view) pass.setBindGroup(run.view.index, run.view.direct)
  pass.setBindGroup(run.sceneGroup, groups.scene)
  pass.dispatchWorkgroupsIndirect(resources.args, PASS_ARGS)
  pass.setPipeline(kernels.finish)
  pass.setBindGroup(0, groups.finish)
  if (run.view) pass.setBindGroup(run.view.index, run.view.finish)
  if (groups.finishScene) pass.setBindGroup(run.sceneGroup, groups.finishScene)
  pass.dispatchWorkgroupsIndirect(resources.args, PASS_ARGS)
}
