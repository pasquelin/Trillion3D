import { PAGE_BIND_ALIGN } from '../../gpu/draw/draw.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import { visBindEntries } from '../core/bindEntries.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/**
 * Bind group of a region: the visibility-buffer raster's, three bindings aside — the instance list
 * is the one culling kept for this region, or the one the occlusion test left visible (`visible`),
 * the slot table places it in that list, and the uniform names the slot. Groups survive images and
 * are rebuilt only if one of the resources they hold has changed identity.
 */
export function shadowRegionGroup(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  region: number,
  visible = false,
) {
  const { vis, gpu, lights } = rt;
  const cacheBuffer = gpu.cache?.buffer,
    { visBindGroupLayout, concatPos, concatUv, pageTable, textures, mapsSampler } = vis;
  const { cull, occlusion } = lights;
  if (
    !visBindGroupLayout ||
    !cacheBuffer ||
    !concatPos ||
    !concatUv ||
    !pageTable ||
    !textures ||
    !mapsSampler ||
    !vis.zeroFlags ||
    !cull
  )
    return;
  // What the groups name and which can change identity — the colour tile pool, not the streamer
  // that holds it — compared in place: nothing is allocated per region or per image.
  const key = lights.shadowGroupsKey,
    pool = textures.color.views;
  if (
    key[0] !== cacheBuffer ||
    key[1] !== concatPos ||
    key[2] !== concatUv ||
    key[3] !== pageTable ||
    key[4] !== pool ||
    key[5] !== cull.kept ||
    key[6] !== occlusion?.visible
  ) {
    key[0] = cacheBuffer;
    key[1] = concatPos;
    key[2] = concatUv;
    key[3] = pageTable;
    key[4] = pool;
    key[5] = cull.kept;
    key[6] = occlusion?.visible;
    lights.shadowGroups.fill(undefined);
  }
  const instances = visible && occlusion ? occlusion.visible : cull.kept,
    slot = region + (instances === cull.kept ? 0 : MAX_SHADOW_REGIONS);
  let group = lights.shadowGroups[slot];
  if (!group) {
    group = device.createBindGroup({
      layout: visBindGroupLayout,
      entries: visBindEntries({
        cache: cacheBuffer,
        position: concatPos,
        pageTable,
        flags: vis.zeroFlags,
        uniform: cull.drawUniform,
        uniformOffset: region * PAGE_BIND_ALIGN,
        uv: concatUv,
        textures,
        sampler: mapsSampler,
        instances,
        slotOffsets: cull.offsets,
      }),
    });
    lights.shadowGroups[slot] = group;
  }
  return group;
}
