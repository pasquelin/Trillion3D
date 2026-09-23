import { DRAW_INDIRECT_STRIDE, PAGE_BIND_ALIGN } from '../../../gpu/draw/draw.ts';
import { SHADOW_PASS } from '../../../gpu/shadow/atlas.ts';
import { visBindEntries } from '../../core/bindEntries.ts';
import { regionScissor, regionViewport } from './encodeShadows.ts';
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
 * Shadow depth pass: first the casters of each redrawn face, selected from the light and culled
 * per region (`encodeShadowCasters`); then one render pass for all regions, and one indirect draw
 * per region.
 *
 * **The viewport stays that of the whole face; only the scissor bounds the region.** That is the
 * whole rule: a vertex lands on exactly the same texel as in a full redraw, and the scissor only
 * drops pixels outside the region. Clear-to-far follows the same scissor, so pages the region does
 * not cover keep the depth they had. Two draw calls per region, whatever the scene's coplanar layer
 * count.
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
  lights.lightRuns = 0;
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
    const viewport = region * 3,
      scissor = region * 4;
    const side = regionViewport[viewport + 2];
    if (side <= 0) continue;
    const group = shadowRegionGroup(rt, device, region);
    if (!group) continue;
    pass.setViewport(regionViewport[viewport], regionViewport[viewport + 1], side, side, 0, 1);
    pass.setScissorRect(
      regionScissor[scissor],
      regionScissor[scissor + 1],
      regionScissor[scissor + 2],
      regionScissor[scissor + 3],
    );
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
