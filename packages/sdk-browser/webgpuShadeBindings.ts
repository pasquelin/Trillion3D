import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Reuses the material resolve bindings on `rt.vis` until their underlying buffers change. */
export function ensureWebgpuShadeBindings(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis } = rt,
    cacheBuffer = rt.gpu.cache?.buffer,
    {
      shadeBindGroupLayout: layout,
      visView,
      concatPos,
      concatUv,
      concatNrm,
      pageTable,
      mapsTexture,
      dataMapsTexture,
      mapsSampler,
      shadeUniform,
    } = vis;
  if (
    !vis.shadeBindGroup &&
    layout &&
    visView &&
    cacheBuffer &&
    concatPos &&
    concatUv &&
    concatNrm &&
    pageTable &&
    mapsTexture &&
    dataMapsTexture &&
    mapsSampler &&
    shadeUniform
  ) {
    const mapsArrayView = (vis.mapsArrayView ??= mapsTexture.createView({ dimension: '2d-array' }));
    const dataMapsArrayView = (vis.dataMapsArrayView ??= dataMapsTexture.createView({
      dimension: '2d-array',
    }));
    vis.shadeBindGroup = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: visView },
        { binding: 1, resource: { buffer: cacheBuffer } },
        { binding: 2, resource: { buffer: concatPos } },
        { binding: 3, resource: { buffer: concatUv } },
        { binding: 4, resource: { buffer: concatNrm } },
        { binding: 5, resource: { buffer: pageTable } },
        { binding: 6, resource: mapsArrayView },
        { binding: 7, resource: mapsSampler },
        { binding: 8, resource: { buffer: shadeUniform } },
        { binding: 9, resource: dataMapsArrayView },
      ],
    });
  }
}
