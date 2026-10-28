import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { standInTexture } from '../../gpu/core/standIns.ts'
import { arrayView } from '../../gpu/core/textureViews.ts'
import { PROFILE_ATLAS_FORMAT } from './profileAtlas.ts'
import type { LightProfileResources } from './profileBindings.ts'

/**
 * THE LIGHT PROFILES' ATLAS OF A SCENE WITH NONE: one texel of zero in a one-slice array and the profiles' sampler, made once a
 * device. A program that reads the profiles is given it where the scene names none; a lane of 0 never samples it.
 */
export const lightProfileStandIn = oncePerDevice((device: GPUDevice): LightProfileResources => ({
  view: arrayView(standInTexture(device, 'Trillion3D no light profile', PROFILE_ATLAS_FORMAT)),
  sampler: postSamplers(device).clamped,
}))
