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
    mapsSampler
  ) {
    const mapsArrayView = (vis.mapsArrayView ??= mapsTexture.createView({ dimension: '2d-array' }));
    const make = (flags: GPUBuffer) =>
      device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: cacheBuffer } },
          { binding: 1, resource: { buffer: concatPos } },
          { binding: 2, resource: { buffer: pageTable } },
          { binding: 3, resource: { buffer: flags } },
          { binding: 4, resource: { buffer: visUniform, offset: 0, size: 96 } },
          { binding: 5, resource: { buffer: concatUv } },
          { binding: 6, resource: mapsArrayView },
          { binding: 7, resource: mapsSampler },
          { binding: 8, resource: { buffer: zeroFlags } },
          { binding: 9, resource: { buffer: zeroFlags } },
        ],
      });
    vis.visBindGroup ??= make(zeroFlags);
    if (hizFlags) vis.visHizBindGroup ??= make(hizFlags);
  }
}
