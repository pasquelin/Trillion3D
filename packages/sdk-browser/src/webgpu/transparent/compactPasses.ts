import { ceilDiv, workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { TRANSPARENT_COMPACT_SHADER } from './shader.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { shaderFailed } from '../../gpu/core/shaderModule.ts'
import { TRANSPARENT_GROUP, type TransparentTable } from './table.ts'
import { TRANSPARENT_COMPACTION_PASS } from '../../stage/passLabels.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import { buildComputeStages } from '../../gpu/core/computeStages.ts'
import { UNIFORM_WORDS, type CompactBuffers } from './compactBuffers.ts'

/** The compaction's layout: its nine buffers, the uniform at 1, the inputs read-only. */
function compactLayout(device: GPUDevice) {
  const readOnly = [0, 2, 7, 8]
  return device.createBindGroupLayout({
    entries: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer:
        binding === 1
          ? { type: 'uniform' as const }
          : readOnly.includes(binding)
            ? { type: 'read-only-storage' as const }
            : { type: 'storage' as const },
    })),
  })
}

/** The compute half's kernels: the three passes that turn the frame's selection mask into instance
 *  lists, compiled once whatever the table's size. Undefined on a device that refuses them. */
export async function compactKernels(device: GPUDevice) {
  const layout = compactLayout(device)
  const module = device.createShaderModule({ code: TRANSPARENT_COMPACT_SHADER })
  if (await shaderFailed(module)) return undefined
  const entryPoints = [
    'countTransparentGroups',
    'prefixTransparentItems',
    'scatterTransparentGroups',
  ] as const
  const stages = await buildComputeStages(device, [layout], module, entryPoints)
  return { layout, pipelines: entryPoints.map((entry) => stages[entry]) }
}

type Kernels = NonNullable<Awaited<ReturnType<typeof compactKernels>>>

/** The passes on the buffers `held` names, for the table as it stands at each image. */
export function compactPasses(
  device: GPUDevice,
  kernels: Kernels,
  table: TransparentTable,
  held: () => CompactBuffers,
) {
  const { layout, pipelines } = kernels
  const bindTo = (mask: GPUBuffer, made: CompactBuffers) =>
    device.createBindGroup({
      layout,
      entries: sequentialEntries(
        [
          made.entriesBuf,
          made.uniforms,
          mask,
          made.groupCounts,
          made.groupOffsets,
          made.instanceBuffer,
          made.indirectBuffer,
          made.itemRangesBuf,
          made.occludedBuffer,
        ].map((buffer) => ({ buffer })),
      ),
    })
  // The group over the mask and the held buffers, made again when either moved.
  const bound = createWebgpuBindIdentity()
  let bindGroup: GPUBindGroup | undefined
  const uniData = new Uint32Array(UNIFORM_WORDS)
  return (encoder: GPUCommandEncoder, mask: GPUBuffer, maskOffset: number) => {
    const made = held()
    const groups = workgroupCount(table.length, TRANSPARENT_GROUP)
    const items = Math.max(1, table.pagedItems.length)
    // A workgroup a group, a thread an item, a workgroup a group.
    const launches = [groups, ceilDiv(items, WORKGROUP_THREADS), groups]
    uniData[0] = table.length
    uniData[1] = groups
    uniData[2] = table.pagedItems.length
    uniData[3] = maskOffset
    uniData[4] = table.maxVertexWords
    bound.next[0] = mask
    bound.next[1] = made
    if (bound.moved()) bindGroup = bindTo(mask, made)
    device.queue.writeBuffer(made.uniforms, 0, uniData)
    const pass = encoder.beginComputePass({ label: TRANSPARENT_COMPACTION_PASS })
    pass.setBindGroup(0, bindGroup!)
    for (let step = 0; step < 3; step++) {
      pass.setPipeline(pipelines[step])
      dispatchRows(pass, launches[step])
    }
    pass.end()
  }
}
