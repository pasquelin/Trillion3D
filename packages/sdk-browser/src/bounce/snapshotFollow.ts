import { buildComputeStage } from '../gpu/core/computeStages.ts'
import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts'
import { computeBufferEntry, namedEntries } from '../gpu/core/computeBindings.ts'
import { atlasEntry } from './atlas.ts'
import { BOUNCE_SNAPSHOT_SHADER, snapshotGroups } from './probeWgsl.ts'
import { SNAPSHOT_BINDINGS } from './probeBindings.ts'

/** Encodes, in the probe pass after an update of `groups` probes, the snapshot's follow-up. */
export type SnapshotFollow = (pass: GPUComputePassEncoder, groups: number) => void

/**
 * The snapshot's follow-up (`BOUNCE_SNAPSHOT_SHADER`) on the cascades' grid, the probe queue and
 * the two atlases: its pipeline, compiled off the thread, and its one group. The texels the
 * update wrote reach the snapshot by a dispatch of the update's pass, where the whole atlas was
 * copied outside it each image.
 */
export async function createSnapshotFollow(
  device: GPUDevice,
  grid: GPUBuffer,
  queue: GPUBuffer,
  probes: GPUTextureView,
  snapshot: GPUTextureView,
): Promise<SnapshotFollow> {
  const module = await createCheckedShaderModule(device, BOUNCE_SNAPSHOT_SHADER, 'BOUNCE_SNAPSHOT')
  const B = SNAPSHOT_BINDINGS
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(B.grid, 'uniform'),
      computeBufferEntry(B.queue, 'read-only-storage'),
      atlasEntry(B.probes),
      atlasEntry(B.snapshot, true),
    ],
  })
  const pipeline = await buildComputeStage(device, [layout], module, 'followSnapshot')
  const group = device.createBindGroup({
    layout,
    entries: namedEntries(B, {
      grid: { buffer: grid },
      queue: { buffer: queue },
      probes,
      snapshot,
    }),
  })
  return (pass, groups) => {
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(snapshotGroups(groups), 1, 1)
  }
}
