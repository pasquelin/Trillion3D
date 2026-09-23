import { refreshTransparentSpans } from './spans.ts';
import { refreshTransparentCorners } from './occlusionHost.ts';
import { writeCpuTransparentInstances } from '../blend/selection.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/**
 * The transparent instance lists of one image.
 *
 * On the GPU path the compaction reads the very mask this frame's cluster cut wrote, so the
 * transparents are selected, ordered and counted by the same cut as the opaques, in the same
 * submission. On the CPU path the same buffer is written from the CPU cut instead, in the same
 * table order, and the draw reads it the same way.
 */
export function encodeTransparentInstances(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { blendState, run } = rt,
    { table, compaction } = blendState;
  if (!table || !compaction) return;
  refreshTransparentSpans(rt);
  const selection = run.gpuFrameActive ? run.gpuSelection : undefined;
  if (selection && compaction.encode) {
    // The occlusion verdict is written just before the compaction, in the same submission and on
    // this frame's pyramid: the compaction never reads another frame's verdict.
    refreshTransparentCorners(rt);
    if (blendState.occlusion) blendState.occlusion.encode(encoder, run.hizPyramidFresh);
    else encoder.clearBuffer(compaction.occludedBuffer);
    compaction.encode(encoder, selection.maskBuffer, selection.maskOffset);
    return;
  }
  writeCpuTransparentInstances(blendState, run.drawn, (rec) => {
    const page = rt.layout.rows.pageIndexOf(rec);
    return page === undefined ? -1 : table.entryOfPage[page];
  });
  compaction.uploadInstances(
    blendState.cpuInstances,
    blendState.cpuInstanceCount,
    blendState.cpuItemCounts,
  );
}
