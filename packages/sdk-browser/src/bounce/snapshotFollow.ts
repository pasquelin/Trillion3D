import { buildComputePipeline } from '../lighting/deferred/fullscreen.ts';
import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts';
import { bounceGroup, bounceLayout, type BounceSlot } from './bindings.ts';
import { BOUNCE_SNAPSHOT_SHADER, snapshotGroups } from './probeWgsl.ts';

/** The follow-up's slots: grid, queue, the probes it reads and the snapshot it writes. */
const SNAPSHOT_TYPES: BounceSlot[] = [
  'uniform',
  'read-only-storage',
  'atlas-array',
  'atlas-array-out',
];

/** Encodes, in the probe pass after an update of `groups` probes, the snapshot's follow-up. */
export type SnapshotFollow = (pass: GPUComputePassEncoder, groups: number) => void;

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
  const module = await createCheckedShaderModule(device, BOUNCE_SNAPSHOT_SHADER, 'BOUNCE_SNAPSHOT');
  const layout = bounceLayout(device, SNAPSHOT_TYPES);
  const pipeline = await buildComputePipeline(device, {
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'followSnapshot' },
  });
  const group = bounceGroup(device, layout, [grid, queue, probes, snapshot], SNAPSHOT_TYPES);
  return (pass, groups) => {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(snapshotGroups(groups), 1, 1);
  };
}
