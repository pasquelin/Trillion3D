import { EngineError } from '../../contracts/cache.ts'
import { isFiniteNumber } from '../../../../math/src/scalar/reals.ts'
import type { SceneLight } from './contracts.ts'
import { validateForwardShadingPriority } from './forwardLight.ts'
import { validateLightCloudShadow } from './lightCloudShadow.ts'
import { validateLightContactShadow } from './lightContactShadow.ts'
import { validateLightShafts } from './lightShafts.ts'
import { validateLocalNumbers, validateShares } from './validateLamp.ts'

/** The factor on the resolution a local light's shadow is given, into `validated` where named: a
 *  number of at least 0, refused on a directional light, whose clipmaps have none. */
function validateShadowResolutionScale(light: SceneLight, validated: SceneLight) {
  const { id, kind, shadowResolutionScale: scale } = light
  if (scale === undefined) return
  if (kind === 'directional')
    throw new EngineError(
      'INVALID_SCENE_LIGHT',
      `${id}: shadowResolutionScale exists only for a point, a spot or a rect`,
      { shadowResolutionScale: scale },
    )
  if (!isFiniteNumber(scale) || scale < 0)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: shadowResolutionScale must be >= 0`, {
      shadowResolutionScale: scale,
    })
  validated.shadowResolutionScale = scale
}

/** The settings a light holds beside its own numbers, validated into `validated`: its shadow's
 *  resolution scale, the shares of its diffuse and specular light, its blend with the inverse exposure, its draw distance, its priority for the forward
 *  light, its light shafts, its cloud shadows and its contact shadows, each by the module that owns
 *  the rules of its fields. */
export function validateLightSettings(light: SceneLight, validated: SceneLight) {
  validateShadowResolutionScale(light, validated)
  validateShares(light, validated)
  validateLocalNumbers(light, validated)
  validateForwardShadingPriority(light, validated)
  validateLightShafts(light, validated)
  validateLightCloudShadow(light, validated)
  validateLightContactShadow(light, validated)
}
