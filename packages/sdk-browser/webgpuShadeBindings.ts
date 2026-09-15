import { shadeBindEntries } from './webgpuBindEntries.ts';
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
      preview,
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
    shadeUniform &&
    preview
  ) {
    const mapsArrayView = (vis.mapsArrayView ??= mapsTexture.createView({ dimension: '2d-array' }));
    const dataMapsArrayView = (vis.dataMapsArrayView ??= dataMapsTexture.createView({
      dimension: '2d-array',
    }));
    vis.shadeBindGroup = device.createBindGroup({
      layout,
      entries: shadeBindEntries({
        visView,
        cache: cacheBuffer,
        position: concatPos,
        uv: concatUv,
        normal: concatNrm,
        pageTable,
        maps: mapsArrayView,
        sampler: mapsSampler,
        uniform: shadeUniform,
        dataMaps: dataMapsArrayView,
        preview,
      }),
    });
  }
}
