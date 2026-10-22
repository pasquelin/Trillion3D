import { buildComputeStage } from '../../../gpu/core/computeStages.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { computeBufferEntry, namedEntries } from '../../../gpu/core/computeBindings.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { atlasEntry } from '../atlas.ts'
import { BOUNCE_TABLE_SHADER } from './tableWgsl.ts'
import { TABLE_BINDINGS } from './probeBindings.ts'

/** Encodes, in the probe pass before the update, the writes of `records` texels of the table. */
export type TableWrite = (pass: GPUComputePassEncoder, records: number) => void

/**
 * The table's writes (`BOUNCE_TABLE_SHADER`) on the records' queue and the two atlases: its pipeline,
 * compiled off the thread, and its one group.
 */
export async function createTableWrite(
  device: GPUDevice,
  records: GPUBuffer,
  probes: GPUTextureView,
  snapshot: GPUTextureView,
): Promise<TableWrite> {
  const module = await createCheckedShaderModule(device, BOUNCE_TABLE_SHADER, 'BOUNCE_TABLE')
  const B = TABLE_BINDINGS
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(B.records, 'read-only-storage'),
      atlasEntry(B.probes, true),
      atlasEntry(B.snapshot, true),
    ],
  })
  const pipeline = await buildComputeStage(device, [layout], module, 'writeTable')
  const group = device.createBindGroup({
    layout,
    entries: namedEntries(B, { records: { buffer: records }, probes, snapshot }),
  })
  return (pass, count) => {
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(ceilDiv(count, WORKGROUP_THREADS), 1, 1)
  }
}
