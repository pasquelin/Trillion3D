// What the rest compaction builds (`restCompact.ts`): its four stages and their layouts, and its
// work buffer.
import { REST_COMPACT_SHADER } from './restCompactWgsl.ts'
import { WORKGROUP_THREADS } from '../dispatch/grid.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { shaderFailed } from '../core/shaderModule.ts'
import { computeBufferEntries, computeBufferEntry } from '../core/computeBindings.ts'
import { buildComputeStages } from '../core/computeStages.ts'

/** The four stages of the compaction and their layouts; undefined when the module fails. */
export async function restPipelines(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    entries: computeBufferEntries([
      'storage',
      'storage',
      'read-only-storage',
      'read-only-storage',
      'read-only-storage',
      'storage',
      'uniform',
    ]),
  })
  const module = device.createShaderModule({ code: REST_COMPACT_SHADER })
  if (await shaderFailed(module)) return undefined
  // The argument kernel's group 0 is its own: the dispatches it feeds replace it, for an arguments
  // buffer bound as storage in the dispatch that reads it is refused.
  const argsLayout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(6, 'uniform'),
      computeBufferEntry(7, 'read-only-storage'),
      computeBufferEntry(8, 'storage'),
    ],
  })
  const [stages, argsPipeline] = await Promise.all([
    buildComputeStages(device, [layout], module, ['restCount', 'restScan', 'restScatter']),
    buildComputePipeline(device, {
      layout: device.createPipelineLayout({ bindGroupLayouts: [argsLayout] }),
      compute: { module, entryPoint: 'restArgs' },
    }),
  ])
  return {
    layout,
    argsLayout,
    argsPipeline,
    countPipeline: stages.restCount,
    scanPipeline: stages.restScan,
    scatterPipeline: stages.restScatter,
  }
}

/** Words of the work buffer: the instance list's copy, then each tested slot's count and tiles. */
export const workWords = (copyWords: number, restSlots: number, rows: number) =>
  copyWords + restSlots * (1 + ceilDiv(rows, WORKGROUP_THREADS))

/** The work buffer of `words` words, the compaction's own. */
export const workBuffer = (device: GPUDevice, words: number) =>
  device.createBuffer({
    label: 'Trillion3D rest compaction work',
    size: words * 4,
    usage: GPUBufferUsage.STORAGE,
  })
