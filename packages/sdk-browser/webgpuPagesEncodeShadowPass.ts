import { PAGE_BIND_ALIGN } from './gpuDraw.ts';
import { SHADOW_PASS } from './gpuShadowAtlas.ts';
import { faceRects } from './webgpuPagesEncodeShadows.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Le groupe de liaison d'une face : celui du raster du visibility buffer, à trois liaisons près —
 * la liste d'instances est celle que le rejet a gardée pour cette face, la table des slots la place
 * dans cette liste, et l'uniforme nomme le slot. Les groupes survivent aux images et ne sont
 * rebâtis que si l'une des ressources qu'ils tiennent a changé d'identité.
 */
function shadowFaceGroup(rt: WebgpuPagesRuntime, device: GPUDevice, face: number) {
  const { vis, gpu, lights } = rt;
  const cacheBuffer = gpu.cache?.buffer,
    { visBindGroupLayout, concatPos, concatUv, pageTable, mapsTexture, mapsSampler } = vis;
  const { cull } = lights;
  if (
    !visBindGroupLayout ||
    !cacheBuffer ||
    !concatPos ||
    !concatUv ||
    !pageTable ||
    !mapsTexture ||
    !mapsSampler ||
    !vis.zeroFlags ||
    !cull
  )
    return;
  const key = [cacheBuffer, concatPos, concatUv, pageTable, mapsTexture, vis.zeroFlags, cull.kept];
  if (key.some((resource, index) => lights.shadowGroupsKey[index] !== resource)) {
    lights.shadowGroupsKey = key;
    lights.shadowGroups.fill(undefined);
  }
  let group = lights.shadowGroups[face];
  if (!group) {
    const visMaps = (vis.mapsArrayView ??= mapsTexture.createView({ dimension: '2d-array' }));
    group = device.createBindGroup({
      layout: visBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: cacheBuffer } },
        { binding: 1, resource: { buffer: concatPos } },
        { binding: 2, resource: { buffer: pageTable } },
        { binding: 3, resource: { buffer: vis.zeroFlags } },
        {
          binding: 4,
          resource: { buffer: cull.drawUniform, offset: face * PAGE_BIND_ALIGN, size: 96 },
        },
        { binding: 5, resource: { buffer: concatUv } },
        { binding: 6, resource: visMaps },
        { binding: 7, resource: mapsSampler },
        { binding: 8, resource: { buffer: cull.kept } },
        { binding: 9, resource: { buffer: cull.offsets } },
      ],
    });
    lights.shadowGroups[face] = group;
  }
  return group;
}

/**
 * La passe de profondeur des ombres : d'abord le rejet par face, qui ne garde de la liste
 * d'instances de l'image que les clusters touchant la portée de la lampe et le cône de la face ;
 * puis une seule passe de rendu pour toutes les faces, cadre et ciseaux sur la tranche, tranche
 * remise au fond, et un seul dessin indirect par face. Deux appels de dessin par face, quel que
 * soit le nombre de couches coplanaires de la scène.
 */
export function encodeShadowAtlas(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  faces: number,
) {
  const { lights, vis, run, layout, setup } = rt,
    { shadows, cull, spheres } = lights,
    { gpuDraw } = vis;
  lights.shadowDraws = 0;
  if (!faces || !shadows || !cull || !spheres || !gpuDraw || !vis.visBindGroupLayout) return false;
  const first = shadowFaceGroup(rt, device, 0);
  if (!first) return false;
  cull.flushVolumes(faces);
  cull.encode(
    encoder,
    {
      spheres: spheres.buffer,
      source: gpuDraw.instanceBuffer,
      sourceIndirect: gpuDraw.indirectBuffer,
    },
    faces,
    gpuDraw.slots,
    layout.rows.packedCount,
    Math.max(1, setup.pageBytes / 4),
  );
  lights.shadowDraws = faces;
  const drawsBefore = run.gpuDrawCalls;
  const pass = encoder.beginRenderPass({
    label: SHADOW_PASS,
    colorAttachments: [],
    depthStencilAttachment: { view: shadows.view, depthLoadOp: 'load', depthStoreOp: 'store' },
  });
  for (let face = 0; face < faces; face++) {
    const x = faceRects[face * 3],
      y = faceRects[face * 3 + 1],
      side = faceRects[face * 3 + 2];
    if (side <= 0) continue;
    const group = shadowFaceGroup(rt, device, face);
    if (!group) continue;
    pass.setViewport(x, y, side, side, 0, 1);
    pass.setScissorRect(x, y, side, side);
    pass.setBindGroup(1, shadows.faceGroup, [face * shadows.faceStride]);
    pass.setBindGroup(0, group);
    pass.setPipeline(shadows.clear);
    pass.draw(3);
    run.gpuDrawCalls++;
    pass.setPipeline(shadows.depth);
    pass.drawIndirect(cull.indirect, face * 16);
    run.gpuDrawCalls++;
  }
  pass.end();
  lights.shadowDrawCalls = run.gpuDrawCalls - drawsBefore;
  return true;
}
