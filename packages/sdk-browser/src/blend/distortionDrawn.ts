import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { noTransmissiveInView } from './expand/expansionFrame.ts'
import type { TransmitPipelines } from './stagePipelines.ts'

// What an image's distortion draws, read by its passes (`distortion.ts`).

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
