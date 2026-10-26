import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import { startedComputeStages } from '../../gpu/core/computeStages.ts'
import { LIGHTING_PARAMS } from './lighting/layout.ts'

/** One program of the surface cache on the device. */
export interface Kernel<E extends string> {
  /** The compiled pipeline of `entry`: read once `ready`. */
  pipeline(entry: E): GPUComputePipeline
  readonly ready: boolean
  /** The bind group of the resources `identity` lists, `entries` what it is made of where one of them moved. */
  group(identity: readonly unknown[], entries: () => GPUBindGroupEntry[]): GPUBindGroup
}

/**
 * THE SURFACE CACHE'S ONE KERNEL: the bind group layout — its parameters at binding 0, a uniform of
 * `parameterBytes` (the lighting's by default), then `layoutEntries` —, the pipeline layout, the module of `code`
 * and its entry points compiled off the frame (`startedComputeStages`), and the one bind group, made again only when
 * a resource its `group` names moved.
 */
export function createKernel<E extends string>(
  device: GPUDevice,
  label: string,
  code: string,
  entryPoints: readonly E[],
  layoutEntries: GPUBindGroupLayoutEntry[],
  constants?: Record<string, number>,
  parameterBytes = LIGHTING_PARAMS.words * 4,
): Kernel<E> {
  const layout = device.createBindGroupLayout({
    label: `Trillion3D surface cache ${label}`,
    entries: [computeUniformEntry(0, { minBindingSize: parameterBytes }), ...layoutEntries],
  })
  const stages = startedComputeStages(
    device,
    `Trillion3D surface cache ${label}`,
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    device.createShaderModule({ label: `Trillion3D surface cache ${label}`, code }),
    entryPoints,
    constants,
  )
  const bound = createWebgpuBindIdentity()
  let held: GPUBindGroup | undefined
  return {
    pipeline: (entry) => {
      if (!stages.ready)
        throw new Error(`Trillion3D surface cache ${label}: ${entry} read before ready`)
      return stages.pipelineOf(entry)
    },
    get ready() {
      return stages.ready
    },
    group(identity, entries) {
      bound.next.length = identity.length
      identity.forEach((resource, at) => (bound.next[at] = resource))
      if (bound.moved() || !held)
        held = device.createBindGroup({
          label: `Trillion3D surface cache ${label}`,
          layout,
          entries: entries(),
        })
      return held
    },
  }
}
