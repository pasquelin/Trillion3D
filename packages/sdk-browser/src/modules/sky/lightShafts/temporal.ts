import type { EngineCamera } from '../../../camera/engineCamera.ts'
import type { PreExposure } from '../../../post/exposure/pre.ts'
import type { TaaFrameState } from '../../../post/taa/frameState.ts'
import type { LightShaftFrame } from './run.ts'

/** What the shafts' temporal pass takes of the image: the temporal state, the camera, and the image's
 *  exposure — the one the CPU knows, read once (`PreExposure.exposure`), in both places that take it —
 *  with the pre-exposure the light was written by. None where the view keeps no temporal state. */
export function shaftTemporal(
  temporal: { readonly frame: TaaFrameState } | undefined,
  camera: Pick<EngineCamera, 'viewProjection' | 'eye'>,
  pre: Pick<PreExposure, 'now' | 'exposure'>,
): LightShaftFrame['temporal'] {
  if (!temporal?.frame.active) return undefined
  return {
    state: temporal.frame,
    camera,
    applied: pre.exposure,
    pre: pre.now,
    frameExposure: pre.exposure,
  }
}
