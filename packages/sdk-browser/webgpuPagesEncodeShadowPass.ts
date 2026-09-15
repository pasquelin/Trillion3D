import { DRAW_INDIRECT_STRIDE, PAGE_BIND_ALIGN } from './gpuDraw.ts';
import { SHADOW_PASS } from './gpuShadowAtlas.ts';
import { visBindEntries } from './webgpuBindEntries.ts';
import { regionScissor, regionViewport } from './webgpuPagesEncodeShadows.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Le groupe de liaison d'une région : celui du raster du visibility buffer, à trois liaisons près —
 * la liste d'instances est celle que le rejet a gardée pour cette région, la table des slots la
 * place dans cette liste, et l'uniforme nomme le slot. Les groupes survivent aux images et ne sont
 * rebâtis que si l'une des ressources qu'ils tiennent a changé d'identité.
 */
function shadowFaceGroup(rt: WebgpuPagesRuntime, device: GPUDevice, face: number) {
  const { vis, gpu, lights } = rt;
  const cacheBuffer = gpu.cache?.buffer,
    { visBindGroupLayout, concatPos, concatUv, pageTable, colorAtlas, mapsSampler, slots } = vis;
  const { cull } = lights;
  if (
    !visBindGroupLayout ||
    !cacheBuffer ||
    !concatPos ||
    !concatUv ||
    !pageTable ||
    !colorAtlas ||
    !mapsSampler ||
    !slots ||
    !vis.zeroFlags ||
    !cull
  )
    return;
  const key = [cacheBuffer, concatPos, concatUv, pageTable, colorAtlas, slots.color, cull.kept];
  if (key.some((resource, index) => lights.shadowGroupsKey[index] !== resource)) {
    lights.shadowGroupsKey = key;
    lights.shadowGroups.fill(undefined);
  }
  let group = lights.shadowGroups[face];
  if (!group) {
    group = device.createBindGroup({
      layout: visBindGroupLayout,
      entries: visBindEntries({
        cache: cacheBuffer,
        position: concatPos,
        pageTable,
        flags: vis.zeroFlags,
        uniform: cull.drawUniform,
        uniformOffset: face * PAGE_BIND_ALIGN,
        uv: concatUv,
        colorAtlas,
        sampler: mapsSampler,
        instances: cull.kept,
        slotOffsets: cull.offsets,
        slots,
      }),
    });
    lights.shadowGroups[face] = group;
  }
  return group;
}

/**
 * La passe de profondeur des ombres : d'abord le rejet par région, qui ne garde de la liste
 * d'instances de l'image que les clusters touchant la portée de la lampe et le volume de la région ;
 * puis une seule passe de rendu pour toutes les régions, et un seul dessin indirect par région.
 *
 * **Le cadre reste celui de la face entière ; seul le ciseau borne la région.** C'est toute la
 * règle : un sommet atterrit exactement au même texel que dans un redessin complet, et le ciseau ne
 * fait qu'écarter les pixels hors région. La remise au fond suit le même ciseau, donc les pages que
 * la région ne couvre pas gardent la profondeur qu'elles avaient. Deux appels de dessin par région,
 * quel que soit le nombre de couches coplanaires de la scène.
 */
export function encodeShadowAtlas(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  regions: number,
) {
  const { lights, vis, run, layout, setup } = rt,
    { shadows, cull, spheres } = lights,
    { gpuDraw } = vis;
  lights.shadowDraws = 0;
  if (!regions || !shadows || !cull || !spheres || !gpuDraw || !vis.visBindGroupLayout)
    return false;
  const first = shadowFaceGroup(rt, device, 0);
  if (!first) return false;
  cull.flushVolumes(regions);
  cull.encode(
    encoder,
    {
      spheres: spheres.buffer,
      source: gpuDraw.instanceBuffer,
      sourceIndirect: gpuDraw.indirectBuffer,
    },
    regions,
    gpuDraw.slots,
    layout.rows.packedCount,
    Math.max(1, setup.pageBytes / 4),
  );
  lights.shadowDraws = regions;
  const drawsBefore = run.gpuDrawCalls;
  const pass = encoder.beginRenderPass({
    label: SHADOW_PASS,
    colorAttachments: [],
    depthStencilAttachment: { view: shadows.view, depthLoadOp: 'load', depthStoreOp: 'store' },
  });
  for (let region = 0; region < regions; region++) {
    const side = regionViewport[region * 3 + 2];
    if (side <= 0) continue;
    const group = shadowFaceGroup(rt, device, region);
    if (!group) continue;
    pass.setViewport(regionViewport[region * 3], regionViewport[region * 3 + 1], side, side, 0, 1);
    pass.setScissorRect(
      regionScissor[region * 4],
      regionScissor[region * 4 + 1],
      regionScissor[region * 4 + 2],
      regionScissor[region * 4 + 3],
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
