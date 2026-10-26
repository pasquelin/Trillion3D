import { buildComputeStage } from '../../gpu/core/computeStages.ts'
import { computeBufferEntry } from '../../gpu/core/computeBindings.ts'
import { DAG_ARM_BINDING } from './shader/armWgsl.ts'

/** Where each list's group count lies in `work`, fixed with the layout (`dagWorkLayout`). */
export type DagArmWords = {
  visibleGroups: number
  candGroups: number
  postNodeGroups: number
  postClusterGroups: number
  queueGroups: number
}

/** The arming kernel's group layout: the counts read, the arguments written, at their bindings. */
export const dagArmLayout = (device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: [
      computeBufferEntry(DAG_ARM_BINDING.work, 'read-only-storage'),
      computeBufferEntry(DAG_ARM_BINDING.args, 'storage'),
    ],
  })

/**
 * The arming kernel of the cut's `module` (`shader/armWgsl.ts`) on `layout`, its list words `words`
 * its overrides: compiled off the thread, asked with the cut's stages (`stages.ts`). The caller's
 * validation scope catches what the device refuses.
 */
export const buildDagArm = (
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  words: DagArmWords,
) =>
  buildComputeStage(device, [layout], module, 'dagArm', {
    VISIBLE_GROUPS: words.visibleGroups,
    CAND_GROUPS: words.candGroups,
    POST_NODE_GROUPS: words.postNodeGroups,
    POST_CLUSTER_GROUPS: words.postClusterGroups,
    QUEUE_GROUPS: words.queueGroups,
  })

/** The arming kernel's one group, over the cut's `work` and its arguments `args`. */
export const dagArmGroup = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  work: GPUBuffer,
  args: GPUBuffer,
) =>
  device.createBindGroup({
    layout,
    entries: [
      { binding: DAG_ARM_BINDING.work, resource: { buffer: work } },
      { binding: DAG_ARM_BINDING.args, resource: { buffer: args } },
    ],
  })
