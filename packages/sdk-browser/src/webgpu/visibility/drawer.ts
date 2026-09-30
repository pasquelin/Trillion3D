import { visPipelineFor, visSlotPipeline } from '../pages/prepare/pipelineFor.ts';
import { BASE_SLOTS } from '../../gpu/draw/draw.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { visGroupFor } from './visGroup.ts';

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
  const rootOfPacked = rt.layout.placement.rootOfPacked;
  for (let i = 0; i < rows.packedCount; i++) {
    const pipeline = visPipelineFor(rt, rows.packedRecs[i]!, rootOfPacked[rows.packedPageIndex[i]]);
    if (!pipeline) continue;
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(rows.packedRecs[i]!.array!.length, 1, 0, i);
    run.gpuDrawCalls++;
  }
}
