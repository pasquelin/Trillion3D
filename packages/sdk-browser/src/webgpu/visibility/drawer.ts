import { visPipelineFor, visSlotPipeline } from '../pages/prepare/pipelineFor.ts';
import { visBindEntries } from '../core/bindEntries.ts';
import { BASE_SLOTS } from '../../gpu/draw/draw.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** The bind group of one indirect slot, cached on `rt.vis` until a resource change voids it.
 *  Shadow depth passes reuse exactly these groups: same page table, same selection, same slot
 *  uniform. */
export function visGroupFor(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  slot: number,
  rest: boolean,
) {
  const { vis, gpu } = rt;
  const cacheBuffer = gpu.cache?.buffer,
    { visBindGroupLayout, concatPos, concatUv, pageTable, visUniform, textures, mapsSampler } = vis,
    { gpuDraw } = vis;
  if (
    !visBindGroupLayout ||
    !cacheBuffer ||
    !concatPos ||
    !concatUv ||
    !pageTable ||
    !visUniform ||
    !textures ||
    !mapsSampler ||
    !gpuDraw
  )
    return;
  const flags = rest ? vis.gpuHiz?.flags : vis.zeroFlags;
  if (!flags) return;
  const key = slot * 2 + (rest ? 1 : 0);
  let group = vis.visSlotGroups[key];
  if (!group) {
    group = device.createBindGroup({
      layout: visBindGroupLayout,
      entries: visBindEntries({
        cache: cacheBuffer,
        position: concatPos,
        pageTable,
        flags,
        uniform: visUniform,
        uniformOffset: (slot + 1) * 256,
        uv: concatUv,
        textures,
        sampler: mapsSampler,
        instances: gpuDraw.instanceBuffer,
        slotOffsets: gpuDraw.slotOffsetsBuffer,
      }),
    });
    vis.visSlotGroups[key] = group;
  }
  return group;
}

/**
 * Draws the occluder half (`rest` false) or the tested half, by indirect commands.
 *
 * The call count now depends only on the slot count — three cull modes per coplanar layer — never
 * on the rows or on what the partition decided: each slot's instance count lives in the indirect
 * command the GPU wrote, and a slot nothing fills draws zero instances. Each call counts on
 * `rt.run.gpuDrawCalls`.
 */
export function drawVis(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  rest: boolean,
  useIndirect: boolean,
) {
  const { vis, run } = rt,
    { rows } = rt.layout;
  if (useIndirect) {
    const { gpuDraw } = vis;
    if (!gpuDraw) return;
    // A coplanar layer is one more set of slots, drawn in the same order: its clusters carry their
    // pipeline's depth bias, those of layer 0 do not change.
    for (let layer = 0; layer < vis.drawLayerSlots; layer++) {
      const start = layer * BASE_SLOTS + (rest ? 3 : 0);
      for (let s = start; s < start + 3; s++) {
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
  // Without indirect compaction there is no partition either: the image draws all its rows in one
  // pass, and the tested half does not exist.
  const group = vis.visBindGroup;
  if (rest || !group) return;
  for (let i = 0; i < rows.packedCount; i++) {
    const pipeline = visPipelineFor(rt, rows.packedRecs[i]!);
    if (!pipeline) continue;
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(rows.packedRecs[i]!.array!.length, 1, 0, i);
    run.gpuDrawCalls++;
  }
}
