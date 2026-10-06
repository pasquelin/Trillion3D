import { visPipelineFor, visSlotPipeline } from '../pages/prepare/pipelineFor.ts'
import { BASE_SLOTS, CULL_BINS, HALF_SLOTS } from '../../gpu/draw/draw.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { rowCutout } from '../row/pageRow.ts'
import { opaqueTwin } from './pipelines.ts'
import { visGroupFor } from './visGroup.ts'

/** `pipeline`, or its twin that neither reads the page nor discards when the draw holds no cutout
 *  row — an opaque slot, a row that is none: `maskKeep` keeps every pixel of such a row, so both
 *  write the same words. */
const drawnWith = (pipeline: GPURenderPipeline, cuts: boolean) =>
  (!cuts && opaqueTwin(pipeline)) || pipeline

/**
 * Draws the occluder half (`rest` false) or the tested half, by indirect commands. A tested half
 * whose rejected rows the compaction removed (`compacted`) draws with the occluders' pipelines:
 * every row it holds survives, so the vertex stage has no verdict left to read.
 *
 * Each half draws its opaque slots, then its cutout ones (bins from `CULL_BINS`). An occluder
 * slot, or a compacted tested one, draws its opaque rows with the twin: their depth is down, early
 * rejected, before a cutout fragment reads its page. The call count depends only on the slot count,
 * never on the rows or on what the partition decided: each slot's instance count lives in the
 * indirect command the GPU wrote, and a slot nothing fills draws zero instances. Each call counts
 * on `rt.run.gpuDrawCalls`.
 */
export function drawVis(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  rest: boolean,
  useIndirect: boolean,
  compacted = false,
) {
  const { vis, run } = rt,
    { rows } = rt.layout
  if (useIndirect) {
    const { gpuDraw } = vis
    if (!gpuDraw) return
    // A coplanar layer is one more set of slots, drawn in the same order: its clusters carry their
    // pipeline's depth bias, those of layer 0 do not change.
    for (let layer = 0; layer < vis.drawLayerSlots; layer++) {
      const start = layer * BASE_SLOTS + (rest ? HALF_SLOTS : 0)
      for (let bin = 0; bin < HALF_SLOTS; bin++) {
        const cutout = bin >= CULL_BINS
        // A compacted tested slot draws with its occluder slot's pipeline, a half before.
        const s = start + bin,
          pipeline = visSlotPipeline(rt, rest && compacted ? s - HALF_SLOTS : s),
          group = visGroupFor(rt, device, s, rest)
        if (!pipeline || !group) continue
        pass.setPipeline(drawnWith(pipeline, cutout))
        pass.setBindGroup(0, group)
        pass.drawIndirect(gpuDraw.indirectBuffer, s * 16)
        run.gpuDrawCalls++
      }
    }
    return
  }
  // Without indirect compaction there is no partition either: the image draws all its rows in one
  // pass, and the tested half does not exist.
  const group = vis.visBindGroup
  if (rest || !group) return
  const rootOfPacked = rt.layout.placement.rootOfPacked,
    ints = rows.pageTableInts
  for (let i = 0; i < rows.packedCount; i++) {
    const pipeline = visPipelineFor(rt, rows.packedRecs[i]!, rootOfPacked[rows.packedPageIndex[i]])
    if (!pipeline) continue
    // Without the table's words, a row keeps the cut stage.
    pass.setPipeline(drawnWith(pipeline, !ints || rowCutout(ints, i)))
    pass.setBindGroup(0, group)
    pass.draw(rows.packedRecs[i]!.array!.length, 1, 0, i)
    run.gpuDrawCalls++
  }
}
