import { refreshTransparentSpans } from './spans.ts'
import { refreshTransparentCorners } from './occlusionHost.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/**
 * The transparent instance lists of one image.
 *
 * The compaction reads the very mask this frame's cluster cut wrote, so the transparents are
 * selected, ordered and counted by the same cut as the opaques, in the same submission. `occluded`: the clusters the main view's
 * occlusion test found hidden are stripped; a face of the sky meshes' capture (`../../frame/render/encodeSkyMeshFace.ts`) sees from another
 * place than the view that test ran for, so it strips none and runs no test.
 */
export function encodeTransparentInstances(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  occluded = true,
) {
  const { blendState, run } = rt,
    { table, compaction } = blendState,
    selection = run.gpuSelection
  if (!table) return
  refreshTransparentSpans(rt)
  if (!selection || !compaction?.encode) return
  if (!occluded) {
    encoder.clearBuffer(compaction.occludedBuffer)
    compaction.encode(encoder, selection.maskBuffer, selection.maskOffset)
    return
  }
  // The occlusion verdict is written just before the compaction, in the same submission and on
  // this frame's pyramid: the compaction never reads another frame's verdict.
  const cornered = refreshTransparentCorners(rt, encoder)
  // The image's cull, taken at its head (`beginTransparentOcclusion`), says whether it tests or
  // draws a frozen cut's kept verdicts again (`../../frame/render/cutFreeze.ts`). Without current
  // corners (their kernel compiling) nothing is tested: no entry is stripped.
  if (blendState.occlusion && cornered) blendState.occlusion.encode(encoder, run.hizPyramidFresh)
  else encoder.clearBuffer(compaction.occludedBuffer)
  compaction.encode(encoder, selection.maskBuffer, selection.maskOffset)
}
