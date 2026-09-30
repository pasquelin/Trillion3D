import { shadeBindEntries, type ShadeBindResources } from './bindEntries.ts';
import { entriesReady } from './bindIdentity.ts';
import { liveResources } from './liveEntries.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** The resolve reads the same live descriptors for invalidation and group construction. */
export function ensureWebgpuShadeBindings(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis } = rt,
    identity = vis.shadeIdentity;
  const entries = (identity.entries[0] ??= shadeBindEntries(
    liveResources<ShadeBindResources>({
      visView: () => rt.vis.visView,
      subsurface: () => rt.gpu.surfaces?.subsurfaceView,
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
  if (identity.entriesMoved(vis.shadeBindGroupLayout)) vis.shadeBindGroup = undefined;
  if (!vis.shadeBindGroup && vis.shadeBindGroupLayout && entriesReady(entries))
    vis.shadeBindGroup = device.createBindGroup({ layout: vis.shadeBindGroupLayout, entries });
}
