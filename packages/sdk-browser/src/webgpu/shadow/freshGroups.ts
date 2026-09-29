import type { GpuShadowAtlas } from '../../gpu/shadow/atlas.ts';
import type { ShadowAllocationBuffers } from './allocBuffers.ts';

type FreshGroups = { key: unknown[]; pool: GPUBindGroup; tint: GPUBindGroup[] };
const held = new WeakMap<GPUDevice, FreshGroups>();

/**
 * Group 2 of the draws of the pages the GPU draws itself (`freshDraws.ts`): into the pool, their
 * views, the kept pairs (`pairs`, the region cull's list, free once the host's batches are
 * encoded) and the arguments; into each layer of the transmittance layer, the same after the
 * pool's opaque depth of that layer. Made again only when one of them changed identity.
 */
export function freshGroups(
  device: GPUDevice,
  shadows: GpuShadowAtlas,
  buffers: ShadowAllocationBuffers,
  pairs: GPUBuffer,
) {
  const key = [buffers.freshFaces, pairs, buffers.freshArgs, shadows.targets];
  const cached = held.get(device);
  if (cached && cached.key.every((part, k) => part === key[k])) return cached;
  const { poolLayout, tintLayout } = shadows.freshDraws;
  const entries = [buffers.freshFaces, pairs, buffers.freshArgs].map((buffer, k) => ({
    binding: k + 1,
    resource: { buffer },
  }));
  const made: FreshGroups = {
    key,
    pool: device.createBindGroup({ layout: poolLayout, entries }),
    tint: shadows.targets.map((resource) =>
      device.createBindGroup({
        layout: tintLayout,
        entries: [{ binding: 0, resource }, ...entries],
      }),
    ),
  };
  held.set(device, made);
  return made;
}
