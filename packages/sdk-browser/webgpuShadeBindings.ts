import { shadeBindEntries } from './webgpuBindEntries.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Bind group of the hardware resolve, built when its resources are there. One construction, for
 * prepare as for the image; it is rebuilt when one of the resources it names changed identity —
 * the page pool, the atlases, the visibility target — and never dropped by name elsewhere.
 */
export function ensureWebgpuShadeBindings(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis } = rt,
    cacheBuffer = rt.gpu.cache?.buffer,
    { next } = vis.shadeIdentity,
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
  next[0] = layout;
  next[1] = visView;
  next[2] = cacheBuffer;
  next[3] = concatPos;
  next[4] = concatUv;
  next[5] = concatNrm;
  next[6] = pageTable;
  next[7] = textures?.color.views;
  next[8] = textures?.data.views;
  next[9] = mapsSampler;
  next[10] = shadeUniform;
  if (vis.shadeIdentity.moved()) vis.shadeBindGroup = undefined;
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
