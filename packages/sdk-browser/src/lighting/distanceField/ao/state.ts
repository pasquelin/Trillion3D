import { NEVER_SEEN } from '../../../frame/backend/state/previousCamera.ts'
import {
  NO_SKY_LIGHT_OCCLUSION,
  type SkyLightOcclusionUse,
} from '../../../modules/sky/skyLight/read.ts'
import { createDfaoState, type DfaoState } from './frame.ts'
import { DFAO_READ_WORDS } from './readWgsl.ts'

/**
 * WHAT THE FRAME KEEPS OF THE SKY LIGHT'S DISTANCE-FIELD OCCLUSION (`DistanceFieldFrameState.occlusion`): the
 * view's resources (`DfaoState`), the number of the last image it was drawn at (`seen`: the view's camera of the image before is
 * its history's camera where that is the image — `cameraSeen`), the temporal revision it was drawn at, and what
 * this image leaves for the lighting — the buffers the lit pass reads the image from (`read`, none where nothing was
 * drawn), the words of the read uniform that describes it (`dfaoRead`, `DFAO_READ_WORDS`), and how the sky light
 * applies it (`use`, for `writeSkyLightRead`).
 */
export interface SkyOcclusionState {
  readonly dfao: DfaoState
  seen: number
  revision: number | undefined
  read: SkyOcclusionRead | undefined
  readonly dfaoRead: Float32Array<ArrayBuffer>
  use: SkyLightOcclusionUse
}

/** What the lit pass binds to read the image: the bent normals and depths, packed (`DfaoView.packed`), and the
 *  uniform that describes them (`DfaoView.readParams`). */
export interface SkyOcclusionRead {
  readonly bent: GPUBuffer
  readonly params: GPUBuffer
}

/** A state with nothing drawn. */
export const createSkyOcclusionState = (): SkyOcclusionState => ({
  dfao: createDfaoState(),
  seen: NEVER_SEEN,
  revision: undefined,
  read: undefined,
  dfaoRead: new Float32Array(DFAO_READ_WORDS),
  use: NO_SKY_LIGHT_OCCLUSION,
})

/** Gives the view back; the next image starts without a history. */
export function releaseSkyOcclusion(state: SkyOcclusionState) {
  state.dfao.view?.dispose()
  state.dfao.view = undefined
  state.seen = NEVER_SEEN
  state.read = undefined
  state.use = NO_SKY_LIGHT_OCCLUSION
}

/** How the sky light applies the occlusion this image (`writeSkyLightRead`'s `occlusion`). */
export const skyOcclusionUse = (frame: {
  readonly distanceFields?: { readonly occlusion: SkyOcclusionState }
}): SkyLightOcclusionUse => frame.distanceFields?.occlusion.use ?? NO_SKY_LIGHT_OCCLUSION

/** What the lit pass reads the image from this image, or none where the sky light is not occluded by the distance fields. */
export const skyOcclusionRead = (frame: {
  readonly distanceFields?: { readonly occlusion: SkyOcclusionState }
}): SkyOcclusionRead | undefined => frame.distanceFields?.occlusion.read
