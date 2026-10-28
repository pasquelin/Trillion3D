import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { lightInputsReady } from '../../lightInputsReady.ts'
import type { SurfaceLightingState } from './surfaceLighting.ts'

/**
 * Whether the lighting has begun. It does not begin before its inputs: with the shadows unlanded or the textures coarse, what it lit — and its radiosity remembered over many images —
 * would keep a residue of the instant they came. The frame stays drawn meanwhile (the cache is busy); begun, it follows the inputs as they change.
 */
export function beginLighting(rt: WebgpuPagesRuntime, lighting: SurfaceLightingState) {
  if (!lighting.begun && lightInputsReady(rt)) {
    lighting.begun = true
    lighting.begunAt = rt.run.frame
    lighting.begunFeedback = rt.surfaceCache?.cache?.feedbackFrame ?? 0
  }
  return lighting.begun
}
