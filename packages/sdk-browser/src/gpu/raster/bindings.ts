import { smallBindEntries, type SmallBindResources } from '../../webgpu/core/bindEntries.ts';
import {
  createWebgpuBindIdentity,
  entriesIdentity,
  type WebgpuBindIdentity,
} from '../../webgpu/core/bindIdentity.ts';
import { liveResources } from '../../webgpu/core/liveEntries.ts';
import type { GpuRasterInput } from './types.ts';

/** Each raster variant checks its actual entries, including its selection mask and work buffer. */
export function createRasterBindings(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  work: GPUBuffer,
) {
  const identities: WebgpuBindIdentity[] = [];
  let current: GpuRasterInput;
  return (input: GpuRasterInput) => {
    current = input;
    const identity = (identities[input.groupKey] ??= createWebgpuBindIdentity());
    const entries = (identity.entries[0] ??= smallBindEntries(
      liveResources<SmallBindResources>({
        indices: () => current.indices,
        positions: () => current.positions,
        pages: () => current.pages,
        hizFlags: () => current.hizFlags,
        uniform: () => current.uniform,
        uvs: () => current.uvs,
        textures: () => current.textures,
        sampler: () => current.sampler,
        work: () => work,
        selectionMask: () => current.selection?.maskBuffer ?? current.hizFlags,
      }),
    ));
    identity.next.length = entriesIdentity(entries, identity.next);
    if (identity.moved()) input.groups[input.groupKey] = undefined;
    return (input.groups[input.groupKey] ??= device.createBindGroup({
      layout,
      entries,
    })) as GPUBindGroup;
  };
}
