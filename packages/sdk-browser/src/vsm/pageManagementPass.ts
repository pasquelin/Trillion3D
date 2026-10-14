/**
 * THE PAGE MANAGEMENT CONTEXT of a shadow set (`pageManagementEncode.ts` encodes with it): every
 * kernel's pipe and its groups, the parameters' uniform slots, the cleared indirect arguments and
 * the per-page dispatcher, made once a device and stats permutation, released with the set.
 */
import { vsmPageManagementKernels } from './pageManagementWgsl.ts'
import { vsmComputePipe, type VsmComputePipe } from './passKit.ts'
import { computeUniformEntry, sequentialEntries } from '../gpu/core/computeBindings.ts'
import type { VsmPerPageBin } from './markingPass.ts'
import {
  vsmPerPageDispatcherBytes,
  VsmPerPageDispatcher,
  vsmPerPageDispatchEntries,
} from './perPageDispatch.ts'
import {
  VSM_PM_GROUP_PARAMS,
  VSM_PM_GROUP_PER_PAGE,
  VSM_PM_GROUP_RESOURCES,
  VSM_PM_PARAMS_BYTES,
  type VsmPmKernel,
  vsmPhysicalPageKernels,
} from './physicalPagesWgsl.ts'
import { type VsmResources, vsmBindGroupLayoutEntries } from './resources.ts'
import { uniformSlotBytes, uniformSlots, type UniformSlots } from '../residency/pools.ts'
import type { VsmLayout } from './layout.ts'
import type { PoolSortStage } from '../gpu/pool/sort.ts'

/** Options of the page management passes. */
interface VsmPageManagementOptions {
  /** Stats permutation (one more storage buffer: eight at most in a kernel). Fixed at first use per
   *  `res`. */
  stats?: boolean
}

export interface VsmPageManagementFrame {
  device: GPUDevice
  /** Full + single-page maps this frame. Nothing runs at 0. */
  mapCount: number
  /** Full maps this frame: the mapped-mip propagation only runs when > 0. */
  fullMapCount: number
  /** This frame's per-page dispatcher bins (`VsmMarkingFrame.perPage.all`, ids already in `res.perPageIds`). */
  perPageBins?: readonly VsmPerPageBin[]
  /** Entries uploaded to `res.nextMaps`, for the page address remap. */
  nextMapCount?: number
  options?: VsmPageManagementOptions
}

export const SLOT_MAIN = 0
export const SLOT_ADDRESSES = 1
const SLOT_COUNT = 2
/** Cleared indirect arguments: three 4-word sets. */
const ARGS_INIT_BYTES = 48

type Kernels = ReturnType<typeof vsmPhysicalPageKernels> &
  ReturnType<typeof vsmPageManagementKernels>
export type KernelName = keyof Kernels

/** A kernel's pipe (`vsmPageManagementPipes`) and its group 0 over each frame set. */
export interface Pipe {
  kernel: VsmPmKernel
  pipe: VsmComputePipe
  groups: [GPUBindGroup | undefined, GPUBindGroup | undefined]
}

export interface VsmPageManagementContext {
  device: GPUDevice
  stats: boolean
  pipes: Record<KernelName, Pipe>
  /** The pool sort's stage pipelines among `pipes`, read where bound — compiled by then
   *  (`VsmComputePipe`) —, its stages' group 0 bound as `poolCount`'s. */
  poolSort: (stage: PoolSortStage) => GPUComputePipeline
  params: GPUBuffer
  /** The slots of `params`: their stride, offsets and words. */
  slots: UniformSlots
  /** The CPU image of `params`, laid as the buffer: a slot's change goes up in one write. */
  paramsU32: Uint32Array<ArrayBuffer>
  paramsGroup: GPUBindGroup
  argsInit: GPUBuffer
  dispatcher: VsmPerPageDispatcher
}

/** Bytes a set's page management context holds on a device of `limits`: its parameter slots, its
 *  per-page dispatch slots — both the device's `uniformStride` apart, as `context` lays them — and
 *  its cleared indirect arguments. */
export const vsmPmContextBytes = (limits: { minUniformBufferOffsetAlignment?: number }) =>
  uniformSlotBytes(limits, SLOT_COUNT) + vsmPerPageDispatcherBytes(limits) + ARGS_INIT_BYTES

/** Frees the page management context of `res`, with the set (`destroyEngineVsm`). */
export function releaseVsmPageManagement(res: VsmResources) {
  const ctx = res.pageManagement
  if (!ctx) return
  ctx.params.destroy()
  ctx.argsInit.destroy()
  ctx.dispatcher.destroy()
  res.pageManagement = undefined
}
/** The tables of `res` grew (`growVsmTables`): its groups bind them again, its pipelines, state
 *  and parameters kept. */
export function rebindVsmPageManagement(res: VsmResources) {
  const ctx = res.pageManagement
  if (!ctx) return
  for (const pipe of Object.values(ctx.pipes)) pipe.groups = [undefined, undefined]
  ctx.dispatcher.rebind(res)
}
/** The parameters' group: one dynamic slot of `VsmPmParams`. */
const paramsEntries = () => [
  computeUniformEntry(0, { hasDynamicOffset: true, minBindingSize: VSM_PM_PARAMS_BYTES }),
]

/** Every page management kernel of `layout` and its pipe, made once a device and source
 *  (`vsmComputePipe`): its tables' group, the parameters' and, per page, the dispatch setup's. */
export function vsmPageManagementPipes(device: GPUDevice, layout: VsmLayout, stats: boolean) {
  const kernels: Kernels = {
    ...vsmPhysicalPageKernels(layout, { stats }),
    ...vsmPageManagementKernels(layout),
  }
  const pipes = {} as Record<KernelName, { kernel: VsmPmKernel; pipe: VsmComputePipe }>
  for (const name of Object.keys(kernels) as KernelName[]) {
    const kernel = kernels[name]
    const groups: GPUBindGroupLayoutEntry[][] = []
    groups[VSM_PM_GROUP_RESOURCES] = vsmBindGroupLayoutEntries(
      kernel.specs,
      layout,
      GPUShaderStage.COMPUTE,
    )
    groups[VSM_PM_GROUP_PARAMS] = paramsEntries()
    if (kernel.perPage) groups[VSM_PM_GROUP_PER_PAGE] = vsmPerPageDispatchEntries()
    const label = `vsm.pm.${kernel.label}`
    pipes[name] = {
      kernel,
      pipe: vsmComputePipe(device, label, kernel.code, kernel.entryPoint, groups),
    }
  }
  return pipes
}

export function vsmPageManagementContext(
  res: VsmResources,
  frame: VsmPageManagementFrame,
): VsmPageManagementContext {
  const stats = !!frame.options?.stats
  const existing = res.pageManagement
  if (existing && existing.device === frame.device && existing.stats === stats) return existing
  const device = frame.device
  // Every slot, the parameters' and the per-page dispatch's, at the device's alignment.
  const slots = uniformSlots(device.limits, SLOT_COUNT, VSM_PM_PARAMS_BYTES / 4)
  const dispatcher = new VsmPerPageDispatcher(device, res)
  // The pipes' parameter groups are made of the same entries: this one's group binds to each.
  const paramsLayout = device.createBindGroupLayout({
    label: 'vsm.pm.params',
    entries: paramsEntries(),
  })
  const params = device.createBuffer({
    label: 'vsm.pm.params',
    size: slots.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const paramsGroup = device.createBindGroup({
    label: 'vsm.pm.params',
    layout: paramsLayout,
    entries: sequentialEntries([{ buffer: params, offset: 0, size: VSM_PM_PARAMS_BYTES }]),
  })
  // Cleared indirect args: initialize and tile depths (16, 0, 1, 0); post-process merge (16, 0, 1, 0)
  // + filter set (0, 1, 1, 0).
  const argsInit = device.createBuffer({
    label: 'vsm.pm.argsInit',
    size: ARGS_INIT_BYTES,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(argsInit, 0, new Uint32Array([16, 0, 1, 0, 16, 0, 1, 0, 0, 1, 1, 0]))

  const pipes = {} as Record<KernelName, Pipe>
  for (const [name, made] of Object.entries(vsmPageManagementPipes(device, res.layout, stats)))
    pipes[name as KernelName] = { ...made, groups: [undefined, undefined] }
  existing?.params.destroy()
  existing?.argsInit.destroy()
  existing?.dispatcher.destroy()
  const ctx: VsmPageManagementContext = {
    device,
    stats,
    pipes,
    poolSort: (stage) => pipes[stage].pipe.pipeline,
    params,
    slots,
    paramsU32: new Uint32Array(slots.bytes / 4),
    paramsGroup,
    argsInit,
    dispatcher,
  }
  res.pageManagement = ctx
  return ctx
}
