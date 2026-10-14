import { BLEND_EXPAND_ENTRIES, BLEND_EXPAND_SHADER } from './expandWgsl.ts'
import { blendExpandBindEntries, EXPAND_BINDING } from './expandBindings.ts'
import {
  BLEND_ORDER_ENTRIES,
  BLEND_ORDER_SHADER,
  blendOrderBindEntries,
  ORDER_BINDING,
  ORDER_UNI_WORDS,
} from './orderWgsl.ts'
import { BLEND_VERDICT_SHADER, blendVerdictBindEntries, VERDICT_BINDING } from './verdictWgsl.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { validated } from '../../gpu/core/errorScope.ts'
import { UNI_WORDS } from './expandUniform.ts'
import type { ExpandBuffers } from './expandBuffers.ts'
import { buildComputeStages } from '../../gpu/core/computeStages.ts'

/** One compute kernel as the frame binds it: its group, and its pipelines by entry rank. */
export type Kernel = { group: GPUBindGroup; pipelines: GPUComputePipeline[] }

/** A device's refusal of the kernels: the scene's, by name. */
export const EXPANSION_REFUSED = 'WEBGPU_BLEND_EXPANSION_UNAVAILABLE'

/** The three kernels of the transparent pass, compiled: their layouts and pipelines, which name
 *  no size of the scene. */
export type BlendKernels = NonNullable<Awaited<ReturnType<typeof expandKernels>>>

const VERDICT_ENTRIES = ['judgeBlendItems'] as const

/**
 * The three kernels of the transparent pass — the frustum verdict, the order, then the expansion
 * of the sorted plan — compiled together, off the thread, while the scene prepares: no frame
 * compiles one. The transparents are expanded on the GPU alone (#1483): a device that refuses the
 * kernels refuses the scene by name (`WEBGPU_BLEND_EXPANSION_UNAVAILABLE`). They are compiled once;
 * the scene's buffers are mounted on them (`mountBlendExpand`) as often as the scene's items
 * change.
 */
export async function compileBlendExpand(device: GPUDevice) {
  try {
    const built = await validated(device, () => expandKernels(device))
    if (built) return built
  } catch (error) {
    throw new Error(EXPANSION_REFUSED, { cause: error })
  }
  // The device refused the kernels: no error to carry.
  throw new Error(EXPANSION_REFUSED)
}

/** The kernels' modules, layouts and pipelines, compiled together off the thread; a module that
 *  does not compile throws under its label, with the device's messages. */
async function expandKernels(device: GPUDevice) {
  const [expandModule, orderModule, verdictModule] = await Promise.all([
    createCheckedShaderModule(device, BLEND_EXPAND_SHADER, 'BLEND_EXPAND'),
    createCheckedShaderModule(device, BLEND_ORDER_SHADER, 'BLEND_ORDER'),
    createCheckedShaderModule(device, BLEND_VERDICT_SHADER, 'BLEND_VERDICT'),
  ])
  const expandLayout = device.createBindGroupLayout({ entries: blendExpandBindEntries() })
  const orderLayout = device.createBindGroupLayout({ entries: blendOrderBindEntries() })
  const verdictLayout = device.createBindGroupLayout({ entries: blendVerdictBindEntries() })
  const [expandStages, orderStages, verdictStages] = await Promise.all([
    buildComputeStages(device, [expandLayout], expandModule, BLEND_EXPAND_ENTRIES),
    buildComputeStages(device, [orderLayout], orderModule, BLEND_ORDER_ENTRIES),
    buildComputeStages(device, [verdictLayout], verdictModule, VERDICT_ENTRIES),
  ])
  return {
    expandLayout,
    orderLayout,
    verdictLayout,
    expandStages,
    orderStages,
    verdictStages,
  }
}

/** The compiled kernels on `buffers`. Without a paged primitive there is neither a count nor a
 *  cluster list to read: the kernels never touch those two bindings, and `draws` fills them — the
 *  same group cannot stay empty. */
export function bindKernels(
  device: GPUDevice,
  kernels: BlendKernels,
  buffers: ExpandBuffers,
  shared: { counts: GPUBuffer | undefined; clusters: GPUBuffer | undefined },
  outputs: { expanded: GPUBuffer; args: GPUBuffer },
) {
  const counts = shared.counts ?? buffers.draws
  const expansion: Kernel = {
    group: device.createBindGroup({
      layout: kernels.expandLayout,
      entries: namedEntries(EXPAND_BINDING, {
        uni: { buffer: buffers.uniforms, size: UNI_WORDS * 4 },
        plan: { buffer: buffers.plan },
        keep: { buffer: buffers.keep },
        draws: { buffer: buffers.draws },
        counts: { buffer: counts },
        clusters: { buffer: shared.clusters ?? buffers.draws },
        scratch: { buffer: buffers.scratch },
        expanded: { buffer: outputs.expanded },
        args: { buffer: outputs.args },
      }),
    }),
    pipelines: BLEND_EXPAND_ENTRIES.map((entry) => kernels.expandStages[entry]),
  }
  const order: Kernel = {
    group: device.createBindGroup({
      layout: kernels.orderLayout,
      entries: namedEntries(ORDER_BINDING, {
        uni: { buffer: buffers.steps, size: ORDER_UNI_WORDS * 4 },
        plan: { buffer: buffers.plan },
        keyed: { buffer: buffers.keyed },
        frame: { buffer: buffers.frame },
        sorted: { buffer: buffers.sorted },
        placed: { buffer: buffers.placed },
      }),
    }),
    pipelines: BLEND_ORDER_ENTRIES.map((entry) => kernels.orderStages[entry]),
  }
  const verdict: Kernel = {
    group: device.createBindGroup({
      layout: kernels.verdictLayout,
      entries: namedEntries(VERDICT_BINDING, {
        keyed: { buffer: buffers.keyed },
        draws: { buffer: buffers.draws },
        counts: { buffer: counts },
        frame: { buffer: buffers.frame },
        keep: { buffer: buffers.keep },
        verdict: { buffer: buffers.verdict },
      }),
    }),
    pipelines: VERDICT_ENTRIES.map((entry) => kernels.verdictStages[entry]),
  }
  return { order, expansion, verdict }
}
