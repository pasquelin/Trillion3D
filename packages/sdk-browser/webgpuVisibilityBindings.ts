import { visBindEntries } from './webgpuBindEntries.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Binds row visibility inputs once for untested and Hi-Z-tested passes, on `rt.vis`. */
export function ensureWebgpuVisibilityBindings(rt: WebgpuPagesRuntime, device: GPUDevice) {
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
      mapsTexture,
      mapsSampler,
      preview,
    } = vis;
  if (
    layout &&
    cacheBuffer &&
    concatPos &&
    concatUv &&
    pageTable &&
    visUniform &&
    zeroFlags &&
    mapsTexture &&
    mapsSampler &&
    preview
  ) {
    const mapsArrayView = (vis.mapsArrayView ??= mapsTexture.createView({ dimension: '2d-array' }));
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
          maps: mapsArrayView,
          sampler: mapsSampler,
          instances: zeroFlags,
          slotOffsets: zeroFlags,
          preview,
        }),
      });
    vis.visBindGroup ??= make(zeroFlags);
    if (hizFlags) vis.visHizBindGroup ??= make(hizFlags);
  }
}
