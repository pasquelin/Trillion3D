import { createDfshState, type DfshState } from './frame.ts'

/**
 * WHAT THE FRAME KEEPS OF THE SUN'S DISTANCE-FIELD SHADOW (`DistanceFieldFrameState.sunShadow`): the
 * view's resources (`DfshState`), and the mask this image leaves for the lighting — a buffer of
 * words, one a pixel, a byte a lane of the suns (`mask`, none where nothing was drawn).
 */
export interface SunShadowState {
  readonly dfsh: DfshState
  mask: GPUBuffer | undefined
}

/** A state with nothing drawn. */
export const createSunShadowState = (): SunShadowState => ({
  dfsh: createDfshState(),
  mask: undefined,
})

/** Gives the view back; the next image starts without a mask. */
export function releaseSunShadow(state: SunShadowState) {
  state.dfsh.view?.dispose()
  state.dfsh.view = undefined
  state.mask = undefined
}

/** The mask of the image the frame holds, or none: what the lighting reads (`vsmSunFactor`). */
export const sunShadowMask = (frame: {
  readonly distanceFields?: { readonly sunShadow: SunShadowState }
}) => frame.distanceFields?.sunShadow.mask
