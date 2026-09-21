import { visBindEntries } from './webgpuBindEntries.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Voids every visibility group when one of the resources it names changed identity: the page pool
 * after a resize, the page table after a reallocation, the colour atlas after a layer change, the
 * indirect buffers, the selection mask. Read before any group is served; nothing is dropped by name
 * elsewhere.
 */
function voidStaleVisibilityGroups(rt: WebgpuPagesRuntime) {
  const { vis, gpu, run } = rt,
    { next } = vis.visIdentity;
  next[0] = vis.visBindGroupLayout;
  next[1] = gpu.cache?.buffer;
  next[2] = vis.concatPos;
  next[3] = vis.concatUv;
  next[4] = vis.pageTable;
  next[5] = vis.visUniform;
  next[6] = vis.zeroFlags;
  next[7] = vis.gpuHiz?.flags;
  next[8] = vis.textures?.color.pool.view;
  next[9] = vis.mapsSampler;
  next[10] = vis.gpuDraw;
  next[11] = run.gpuSelection;
  next[12] = vis.gpuRaster;
  if (!vis.visIdentity.moved()) return;
  vis.visBindGroup = undefined;
  vis.visHizBindGroup = undefined;
  vis.visSlotGroups.fill(undefined);
  vis.rasterGroups.fill(undefined);
}

/** Binds row visibility inputs once for untested and Hi-Z-tested passes, on `rt.vis`. */
export function ensureWebgpuVisibilityBindings(rt: WebgpuPagesRuntime, device: GPUDevice) {
  voidStaleVisibilityGroups(rt);
  const { vis } = rt,
    cacheBuffer = rt.gpu.cache?.buffer,
    hizFlags = vis.gpuHiz?.flags,
    {
      visBindGroupLayout: layout,
      concatPos,
      concatUv,
      pageTable,
      visUniform,
      zeroFlags,
      textures,
      mapsSampler,
    } = vis;
  if (
    layout &&
    cacheBuffer &&
    concatPos &&
    concatUv &&
    pageTable &&
    visUniform &&
    zeroFlags &&
    textures &&
    mapsSampler
  ) {
    const make = (flags: GPUBuffer) =>
      device.createBindGroup({
        layout,
        entries: visBindEntries({
          cache: cacheBuffer,
          position: concatPos,
          pageTable,
          flags,
          uniform: visUniform,
          uniformOffset: 0,
          uv: concatUv,
          textures,
          sampler: mapsSampler,
          instances: zeroFlags,
          slotOffsets: zeroFlags,
        }),
      });
    vis.visBindGroup ??= make(zeroFlags);
    if (hizFlags) vis.visHizBindGroup ??= make(hizFlags);
  }
}
