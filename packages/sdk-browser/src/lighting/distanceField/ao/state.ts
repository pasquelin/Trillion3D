import {
  NO_SKY_LIGHT_OCCLUSION,
  type SkyLightOcclusionUse,
} from '../../../modules/sky/skyLight/read.ts'
import { createDfaoState, type DfaoState } from './frame.ts'
import { DFAO_READ_WORDS } from './readWgsl.ts'

/**
 * WHAT THE FRAME KEEPS OF THE SKY LIGHT'S DISTANCE-FIELD OCCLUSION (`DistanceFieldFrameState.occlusion`): the
 * view's resources (`DfaoState`), the last image's view-projection, the temporal revision it was drawn at, and what
 * this image leaves for the lighting — the texture of the bent normals (`output`, none where nothing was drawn), the
 * words of the read uniform that describes it (`dfaoRead`, `DFAO_READ_WORDS`), and how the sky light applies it
 * (`use`, for `writeSkyLightRead`).
 */
export interface SkyOcclusionState {
  readonly dfao: DfaoState
  readonly previous: Float64Array
  hasPrevious: boolean
  revision: number | undefined
  output: GPUTextureView | undefined
  readonly dfaoRead: Float32Array
  use: SkyLightOcclusionUse
}

/** A state with nothing drawn. */
export const createSkyOcclusionState = (): SkyOcclusionState => ({
  dfao: createDfaoState(),
  previous: new Float64Array(16),
  hasPrevious: false,
  revision: undefined,
  output: undefined,
  dfaoRead: new Float32Array(DFAO_READ_WORDS),
  use: NO_SKY_LIGHT_OCCLUSION,
})

/** Gives the view back; the next image starts without a history. */
export function releaseSkyOcclusion(state: SkyOcclusionState) {
  state.dfao.view?.dispose()
  state.dfao.view = undefined
  state.hasPrevious = false
  state.output = undefined
  state.use = NO_SKY_LIGHT_OCCLUSION
}

/** How the sky light applies the occlusion this image (`writeSkyLightRead`'s `occlusion`). */
export const skyOcclusionUse = (frame: {
  readonly distanceFields?: { readonly occlusion: SkyOcclusionState }
}): SkyLightOcclusionUse => frame.distanceFields?.occlusion.use ?? NO_SKY_LIGHT_OCCLUSION
