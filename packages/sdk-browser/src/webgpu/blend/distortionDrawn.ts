import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { noTransmissiveInView } from './expansionFrame.ts'
import type { TransmitPipelines } from './stagePipelines.ts'
import { activeAsIsShare } from '../pages/prepare/asIsShareTarget.ts'

// What an image's distortion draws, read by its passes (`distortion.ts`) and by the blend pass's
// companion (`draw.ts`), which leaves out what the accumulation wrote.

/** Whether the image draws the distortion (`encodeDistortion`): its targets, a refracting item in
 *  the plan (`refracts`), and a transmissive item the verdict may see in view
 *  (`noTransmissiveInView`): without a refracting surface in view the passes would only copy
 *  the scene onto itself, so none is drawn. */
export const drawsDistortion = (
  rt: WebgpuPagesRuntime,
  transmission: TransmitPipelines | undefined,
): transmission is TransmitPipelines => {
  const { gpu, blendState } = rt
  return !!(
    transmission &&
    blendState.refracts &&
    blendState.runCount &&
    gpu.backdrop?.active &&
    gpu.deferred?.uniform &&
    gpu.hdrTexture &&
    !noTransmissiveInView(blendState)
  )
}

/**
 * Whether the image's accumulation also writes what the dual blend's companion pass would
 * (`fsDistortionCoverage`): the image draws the distortion, its transmissive layers blend dual —
 * a device granting it, no display layer on (`drawBlendPass`) — and the companion pass has an
 * output, the request or the share. Its transmissive layers are then drawn once for both, and the
 * companion pass leaves them out (`drawBlendPass`).
 */
export const distortionCovers = (
  rt: WebgpuPagesRuntime,
  transmission: TransmitPipelines | undefined,
) =>
  drawsDistortion(rt, transmission) &&
  !!transmission.dual &&
  !rt.gpu.displayFilter?.active &&
  (rt.vis.writesFeedback || !!activeAsIsShare(rt))
