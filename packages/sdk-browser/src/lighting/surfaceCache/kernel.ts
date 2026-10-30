import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import { startedComputeStages } from '../../gpu/core/computeStages.ts'
import { LIGHTING_PARAMS } from './lighting/layout.ts'

/** One program of the surface cache on the device. */
export interface Kernel<E extends string> {
  /** The compiled pipeline of `entry`: read once `ready`. */
  pipeline(entry: E): GPUComputePipeline
  readonly ready: boolean
  /** Whether a compile of it is in flight. */
  readonly pending: boolean
  /**
   * The bind group `at` (0 the kernel's own, then those of `layouts` of `createKernel`) of the resources `identity`
   * lists, `entries` what it is made of where one of them moved.
   */
  group(identity: readonly unknown[], entries: () => GPUBindGroupEntry[], at?: number): GPUBindGroup
}

/** What a kernel is made with beside its program: the override constants of its module, the bytes of its parameters'
 *  uniform (the lighting's by default) and the layouts of the groups after the first. */
export interface KernelOptions {
  readonly constants?: Record<string, number>
  readonly parameterBytes?: number
  readonly layouts?: GPUBindGroupLayoutEntry[][]
}

/**
 * THE SURFACE CACHE'S ONE KERNEL: the bind group layout — its parameters at binding 0, a uniform of
 * `parameterBytes`, then `layoutEntries` —, the pipeline layout, the module of `code` and its entry points compiled off
 * the frame (`startedComputeStages`), and a bind group for each group it has, made again only when a resource its `group`
 * names moved. A kernel that reads what another library binds in groups of its own has their layouts in `layouts`, in
 * the pipeline layout after the first, from group 1.
 */
export function createKernel<E extends string>(
  device: GPUDevice,
  label: string,
  code: string,
  entryPoints: readonly E[],
  layoutEntries: GPUBindGroupLayoutEntry[],
  { constants, parameterBytes = LIGHTING_PARAMS.words * 4, layouts = [] }: KernelOptions = {},
): Kernel<E> {
  const bindGroupLayouts = [
    [computeUniformEntry(0, { minBindingSize: parameterBytes }), ...layoutEntries],
    ...layouts,
  ].map((entries, at) =>
    device.createBindGroupLayout({
      label: `Trillion3D surface cache ${label} group ${at}`,
      entries,
    }),
  )
  const stages = startedComputeStages(
    device,
    `Trillion3D surface cache ${label}`,
    device.createPipelineLayout({ bindGroupLayouts }),
    device.createShaderModule({ label: `Trillion3D surface cache ${label}`, code }),
    entryPoints,
    constants,
  )
  const bound = bindGroupLayouts.map(() => createWebgpuBindIdentity())
  const held: (GPUBindGroup | undefined)[] = []
  return {
    pipeline: (entry) => {
      if (!stages.ready)
        throw new Error(`Trillion3D surface cache ${label}: ${entry} read before ready`)
      return stages.pipelineOf(entry)
    },
    get ready() {
      return stages.ready
    },
    get pending() {
      return stages.pending
    },
    group(identity, entries, at = 0) {
      const identities = bound[at]
      identities.next.length = identity.length
      identity.forEach((resource, k) => (identities.next[k] = resource))
      if (identities.moved() || !held[at])
        held[at] = device.createBindGroup({
          label: `Trillion3D surface cache ${label} group ${at}`,
          layout: bindGroupLayouts[at],
          entries: entries(),
        })
      return held[at]
    },
  }
}
