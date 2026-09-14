import { visPipelineFor, visSlotPipeline } from './webgpuPagesPipelineFor.ts';
import { BASE_SLOTS } from './gpuDraw.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** The bind group of one indirect slot, cached on `rt.vis` until a resource change voids it.
 *  Les passes de profondeur des ombres réutilisent exactement ces groupes : même table de pages,
 *  même sélection, même uniforme de slot. */
export function visGroupFor(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  slot: number,
  rest: boolean,
) {
  const { vis, gpu } = rt;
  const cacheBuffer = gpu.cache?.buffer,
    { visBindGroupLayout, concatPos, concatUv, pageTable, visUniform, mapsTexture, mapsSampler } =
      vis,
    { gpuDraw } = vis;
  if (
    !visBindGroupLayout ||
    !cacheBuffer ||
    !concatPos ||
    !concatUv ||
    !pageTable ||
    !visUniform ||
    !mapsTexture ||
    !mapsSampler ||
    !gpuDraw
  )
    return;
  const flags = rest ? vis.gpuHiz?.flags : vis.zeroFlags;
  if (!flags) return;
  const key = slot * 2 + (rest ? 1 : 0);
  let group = vis.visSlotGroups[key];
  if (!group) {
    const visMaps = (vis.mapsArrayView ??= mapsTexture.createView({ dimension: '2d-array' }));
    group = device.createBindGroup({
      layout: visBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: cacheBuffer } },
        { binding: 1, resource: { buffer: concatPos } },
        { binding: 2, resource: { buffer: pageTable } },
        { binding: 3, resource: { buffer: flags } },
        { binding: 4, resource: { buffer: visUniform, offset: (slot + 1) * 256, size: 96 } },
        { binding: 5, resource: { buffer: concatUv } },
        { binding: 6, resource: visMaps },
        { binding: 7, resource: mapsSampler },
        { binding: 8, resource: { buffer: gpuDraw.instanceBuffer } },
        { binding: 9, resource: { buffer: gpuDraw.slotOffsetsBuffer } },
      ],
    });
    vis.visSlotGroups[key] = group;
  }
  return group;
}

/** Draws the occluder half (`rest` false) or the tested half; with `twoPass` false, everything.
 *  Every draw counts on `rt.run.gpuDrawCalls`. */
export function drawVis(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  rest: boolean,
  twoPass: boolean,
  useIndirect: boolean,
) {
  const { vis, run } = rt,
    { rows, binInstances, hizRest } = rt.layout;
  if (useIndirect) {
    const { gpuDraw } = vis;
    if (!gpuDraw) return;
    // Une couche coplanaire est un jeu de slots de plus, dessiné dans le même ordre : ses clusters
    // portent le décalage de profondeur de leur pipeline, ceux de la couche 0 ne changent pas.
    for (let layer = 0; layer < vis.drawLayerSlots; layer++) {
      const start = layer * BASE_SLOTS + (rest ? 3 : 0);
      for (let s = start; s < start + 3; s++) {
        if (!binInstances[s]) continue;
        const pipeline = visSlotPipeline(rt, s),
          group = visGroupFor(rt, device, s, rest);
        if (!pipeline || !group) continue;
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.drawIndirect(gpuDraw.indirectBuffer, s * 16);
        run.gpuDrawCalls++;
      }
    }
    return;
  }
  const group = rest ? (vis.visHizBindGroup ?? vis.visBindGroup) : vis.visBindGroup;
  if (!group) return;
  for (let i = 0; i < rows.packedCount; i++) {
    if (twoPass && (hizRest[i] !== 0) !== rest) continue;
    const pipeline = visPipelineFor(rt, rows.packedRecs[i]!, rest);
    if (!pipeline) continue;
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(rows.packedRecs[i]!.array!.length, 1, 0, i);
    run.gpuDrawCalls++;
  }
}
