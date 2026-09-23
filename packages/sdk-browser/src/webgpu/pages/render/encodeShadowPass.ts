import { DRAW_INDIRECT_STRIDE, PAGE_BIND_ALIGN } from '../../../gpu/draw/draw.ts';
import { SHADOW_PASS } from '../../../gpu/shadow/atlas.ts';
import { SHADOW_LAYER_PASS } from '../../../gpu/shadow/staticLayer.ts';
import { visBindEntries } from '../../core/bindEntries.ts';
import { REGION_RESTORE, REGION_STATIC } from '../../shadow/regions.ts';
import { SHADOW_PAGE } from '../../../../../sdk-core/src/scene/light-shadow/virtual.ts';
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
 * culled per region (`encodeShadowCasters`); then the static layer's pages drawn in full, if any;
 * then one render pass over the pool, where each region starts from its page cleared to far or
 * restored from the static layer, and draws its casters.
 *
 * **The viewport is the physical page, the matrix the virtual page's own projection.** The page
 * fills the clip square, so the rasterizer clips every caster at its edge and no other page of the
 * pool is touched; the scissor says the same square once more.
 */
export function encodeShadowAtlas(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  count: number,
) {
  const { lights, vis, run } = rt,
    { shadows, cull, regions, staticLayer } = lights;
  lights.shadowDraws = 0;
  if (!count || !shadows || !cull || !vis.visBindGroupLayout) return false;
  if (regions.layered && !staticLayer) return false;
  if (!shadowRegionGroup(rt, device, 0)) return false;
  if (!encodeShadowCasters(rt, encoder, count)) return false;
  cull.counts.sample(encoder, cull.indirect, count, run.frame);
  lights.shadowDraws = count;
  const drawsBefore = run.gpuDrawCalls;
  const draw = (target: GPUTextureView, label: string, layer: boolean) => {
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [],
      depthStencilAttachment: { view: target, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    for (let region = 0; region < count; region++) {
      const start = regions.startOf(region);
      if (layer !== (start === REGION_STATIC)) continue;
      const group = shadowRegionGroup(rt, device, region);
      if (!group) continue;
      const x = regions.x(region),
        y = regions.y(region);
      pass.setViewport(x, y, SHADOW_PAGE, SHADOW_PAGE, 0, 1);
      pass.setScissorRect(x, y, SHADOW_PAGE, SHADOW_PAGE);
      if (start === REGION_RESTORE) {
        pass.setPipeline(staticLayer!.restore);
        pass.setBindGroup(0, staticLayer!.group);
      } else pass.setPipeline(shadows.clear);
      pass.setBindGroup(1, shadows.faceGroup, [region * shadows.faceStride]);
      if (start !== REGION_RESTORE) pass.setBindGroup(0, group);
      pass.draw(3);
      pass.setPipeline(shadows.depth);
      pass.setBindGroup(0, group);
      pass.setBindGroup(1, shadows.faceGroup, [region * shadows.faceStride]);
      pass.drawIndirect(cull.indirect, region * DRAW_INDIRECT_STRIDE);
      run.gpuDrawCalls += 2;
    }
    pass.end();
  };
  if (regions.layered) draw(staticLayer!.view, SHADOW_LAYER_PASS, true);
  draw(shadows.view, SHADOW_PASS, false);
  lights.shadowDrawCalls = run.gpuDrawCalls - drawsBefore;
  return true;
}
