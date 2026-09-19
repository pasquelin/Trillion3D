import { shadeBindEntries } from './webgpuBindEntries.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Bind group of the hardware resolve, built when its resources are there. One construction, for
 *  prepare as for the image; it is rebuilt after invalidation. */
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
      textures,
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
    textures &&
    mapsSampler &&
    shadeUniform
  ) {
    vis.shadeBindGroup = device.createBindGroup({
      layout,
      entries: shadeBindEntries({
        visView,
        cache: cacheBuffer,
        position: concatPos,
        uv: concatUv,
        normal: concatNrm,
        pageTable,
        textures,
        sampler: mapsSampler,
        uniform: shadeUniform,
      }),
    });
  }
}
