import { visBindEntries, type VisBindResources } from '../core/bindEntries.ts';
import { entriesIdentity } from '../core/bindIdentity.ts';
import { liveResources } from '../core/liveEntries.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

export function visibilityEntries(rt: WebgpuPagesRuntime, hiz: boolean, slot = -1) {
  return visBindEntries(
    liveResources<VisBindResources>({
      cache: () => rt.gpu.cache?.buffer,
      position: () => rt.vis.concatPos,
      uv: () => rt.vis.concatUv,
      pageTable: () => rt.vis.pageTable,
      flags: () => (hiz ? rt.vis.gpuHiz?.flags : rt.vis.zeroFlags),
      uniform: () => rt.vis.visUniform,
      uniformOffset: () => (slot + 1) * 256,
      textures: () => rt.vis.textures,
      sampler: () => rt.vis.mapsSampler,
      instances: () => (slot < 0 ? rt.vis.zeroFlags : rt.vis.gpuDraw?.instanceBuffer),
      slotOffsets: () => (slot < 0 ? rt.vis.zeroFlags : rt.vis.gpuDraw?.slotOffsetsBuffer),
    }),
  );
}

/** The descriptors used to create the groups are also their identity, including atlas tables. */
function voidStaleVisibilityGroups(rt: WebgpuPagesRuntime) {
  const { vis } = rt,
    identity = vis.visIdentity,
    { next } = identity;
  identity.entries[0] ??= visibilityEntries(rt, false);
  identity.entries[1] ??= visibilityEntries(rt, true);
  identity.entries[2] ??= visibilityEntries(rt, false, 0);
  next[0] = vis.visBindGroupLayout;
  let at = entriesIdentity(identity.entries[0], next, 1);
  at = entriesIdentity(identity.entries[1], next, at);
  at = entriesIdentity(identity.entries[2], next, at);
  next.length = at;
  if (!identity.moved()) return;
  vis.visBindGroup = undefined;
  vis.visHizBindGroup = undefined;
  vis.visSlotGroups.fill(undefined);
  vis.rasterGroups.fill(undefined);
}

/** Binds row visibility inputs once for untested and Hi-Z-tested passes, on `rt.vis`. */
export function ensureWebgpuVisibilityBindings(rt: WebgpuPagesRuntime, device: GPUDevice) {
  voidStaleVisibilityGroups(rt);
  const { vis } = rt;
  if (
    vis.visBindGroupLayout &&
    rt.gpu.cache &&
    vis.concatPos &&
    vis.concatUv &&
    vis.pageTable &&
    vis.visUniform &&
    vis.zeroFlags &&
    vis.textures &&
    vis.mapsSampler
  ) {
    vis.visBindGroup ??= device.createBindGroup({
      layout: vis.visBindGroupLayout,
      entries: vis.visIdentity.entries[0],
    });
    if (vis.gpuHiz?.flags)
      vis.visHizBindGroup ??= device.createBindGroup({
        layout: vis.visBindGroupLayout,
        entries: vis.visIdentity.entries[1],
      });
  }
}
