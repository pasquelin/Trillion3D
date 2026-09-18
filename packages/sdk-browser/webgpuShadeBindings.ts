import { shadeBindEntries } from './webgpuBindEntries.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Le groupe de liaison de la résolution matérielle, bâti quand ses ressources sont là. Une seule
 *  construction, pour la préparation comme pour l'image ; il est refait après invalidation. */
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
