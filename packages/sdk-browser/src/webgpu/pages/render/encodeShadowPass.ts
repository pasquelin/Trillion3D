import { DRAW_INDIRECT_STRIDE, PAGE_BIND_ALIGN } from '../../../gpu/draw/draw.ts';
import { SHADOW_PASS } from '../../../gpu/shadow/atlas.ts';
import { visBindEntries } from '../../core/bindEntries.ts';
import { regionViewport } from '../../shadow/pages.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { encodeShadowCasters } from '../../shadow/casters.ts';

/**
 * Bind group of a region: the visibility-buffer raster's, three bindings aside — the instance list
 * is the one culling kept for this region, the slot table places it in that list, and the uniform
 * names the slot. Groups survive images and are rebuilt only if one of the resources they hold has
 * changed identity.
 */
function shadowRegionGroup(rt: WebgpuPagesRuntime, device: GPUDevice, region: number) {
  const { vis, gpu, lights } = rt;
  const cacheBuffer = gpu.cache?.buffer,
    { visBindGroupLayout, concatPos, concatUv, pageTable, textures, mapsSampler } = vis;
  const { cull } = lights;
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
    key[5] !== cull.kept
  ) {
    key[0] = cacheBuffer;
    key[1] = concatPos;
    key[2] = concatUv;
    key[3] = pageTable;
    key[4] = pool;
    key[5] = cull.kept;
    lights.shadowGroups.fill(undefined);
  }
  let group = lights.shadowGroups[region];
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
        instances: cull.kept,
        slotOffsets: cull.offsets,
      }),
    });
    lights.shadowGroups[region] = group;
  }
  return group;
}

/**
 * Shadow depth pass: first the casters of each light view drawn, selected from the light and
 * culled per page (`encodeShadowCasters`); then one render pass for every page, and two draws per
 * page — a clear to far, then the page's casters.
 *
 * **The viewport is the physical page, the matrix the virtual page's own projection.** The page
 * fills the clip square, so the rasterizer clips every caster at its edge and no other page of the
 * pool is touched; the scissor says the same square once more.
 */
export function encodeShadowAtlas(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  regions: number,
) {
  const { lights, vis, run } = rt,
    { shadows, cull } = lights;
  lights.shadowDraws = 0;
  if (!regions || !shadows || !cull || !vis.visBindGroupLayout) return false;
  const first = shadowRegionGroup(rt, device, 0);
  if (!first) return false;
  if (!encodeShadowCasters(rt, encoder, regions)) return false;
  cull.counts.sample(encoder, cull.indirect, regions, run.frame);
  lights.shadowDraws = regions;
  const drawsBefore = run.gpuDrawCalls;
  const pass = encoder.beginRenderPass({
    label: SHADOW_PASS,
    colorAttachments: [],
    depthStencilAttachment: { view: shadows.view, depthLoadOp: 'load', depthStoreOp: 'store' },
  });
  for (let region = 0; region < regions; region++) {
    const at = region * 3,
      x = regionViewport[at],
      y = regionViewport[at + 1],
      side = regionViewport[at + 2];
    if (side <= 0) continue;
    const group = shadowRegionGroup(rt, device, region);
    if (!group) continue;
    pass.setViewport(x, y, side, side, 0, 1);
    pass.setScissorRect(x, y, side, side);
    pass.setBindGroup(1, shadows.faceGroup, [region * shadows.faceStride]);
    pass.setBindGroup(0, group);
    pass.setPipeline(shadows.clear);
    pass.draw(3);
    run.gpuDrawCalls++;
    pass.setPipeline(shadows.depth);
    pass.drawIndirect(cull.indirect, region * DRAW_INDIRECT_STRIDE);
    run.gpuDrawCalls++;
  }
  pass.end();
  lights.shadowDrawCalls = run.gpuDrawCalls - drawsBefore;
  return true;
}
