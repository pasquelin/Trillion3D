import { shadeBindEntries, type ShadeBindResources } from './bindEntries.ts';
import { entriesIdentity } from './bindIdentity.ts';
import { liveResources } from './liveEntries.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** The resolve reads the same live descriptors for invalidation and group construction. */
export function ensureWebgpuShadeBindings(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis } = rt,
    identity = vis.shadeIdentity;
  const entries = (identity.entries[0] ??= shadeBindEntries(
    liveResources<ShadeBindResources>({
      visView: () => rt.vis.visView,
      cache: () => rt.gpu.cache?.buffer,
      position: () => rt.vis.concatPos,
      uv: () => rt.vis.concatUv,
      normal: () => rt.vis.concatNrm,
      pageTable: () => rt.vis.pageTable,
      textures: () => rt.vis.textures,
      sampler: () => rt.vis.mapsSampler,
      uniform: () => rt.vis.shadeUniform,
    }),
  ));
  identity.next[0] = vis.shadeBindGroupLayout;
  identity.next.length = entriesIdentity(entries, identity.next, 1);
  if (identity.moved()) vis.shadeBindGroup = undefined;
  if (
    !vis.shadeBindGroup &&
    vis.shadeBindGroupLayout &&
    vis.visView &&
    rt.gpu.cache &&
    vis.concatPos &&
    vis.concatUv &&
    vis.concatNrm &&
    vis.pageTable &&
    vis.textures &&
    vis.mapsSampler &&
    vis.shadeUniform
  ) {
    vis.shadeBindGroup = device.createBindGroup({ layout: vis.shadeBindGroupLayout, entries });
  }
}
