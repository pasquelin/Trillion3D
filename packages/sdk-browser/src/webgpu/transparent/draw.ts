import { refreshTransparentSpans } from './spans.ts'
import { refreshTransparentCorners } from './occlusionHost.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

/**
 * The transparent instance lists of one image.
 *
 * The compaction reads the very mask this frame's cluster cut wrote, so the transparents are
 * selected, ordered and counted by the same cut as the opaques, in the same submission.
 */
export function encodeTransparentInstances(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { blendState, run } = rt,
    { table, compaction } = blendState,
    selection = run.gpuSelection
  if (!table) return
  refreshTransparentSpans(rt)
  if (!selection || !compaction?.encode) return
  // The occlusion verdict is written just before the compaction, in the same submission and on
  // this frame's pyramid: the compaction never reads another frame's verdict.
  refreshTransparentCorners(rt)
  if (blendState.occlusion) blendState.occlusion.encode(encoder, run.hizPyramidFresh)
  else encoder.clearBuffer(compaction.occludedBuffer)
  compaction.encode(encoder, selection.maskBuffer, selection.maskOffset)
}
