import { EngineError } from '../../contracts/cache.ts'
import { finite } from '../core/fog.ts'
import type { SceneLight } from './contracts.ts'

/**
 * The two options of a light that say how the volumetric fog and the clouds take it, copied onto
 * `validated` when given: `fogScattering`, a number of 0 or more, and `shadowsFog`, a boolean —
 * refused on a rect, which casts no shadow to give the fog.
 */
export function validateFogFields(light: SceneLight, validated: SceneLight) {
  const { id, fogScattering, shadowsFog } = light
  if (fogScattering !== undefined) {
    if (!finite(fogScattering) || fogScattering < 0)
      throw new EngineError('INVALID_SCENE_LIGHT', `${id}: fogScattering must be >= 0`, {
        fogScattering,
      })
    validated.fogScattering = fogScattering
  }
  if (shadowsFog === undefined) return
  if (typeof shadowsFog !== 'boolean')
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: shadowsFog expects a boolean`, {
      shadowsFog,
    })
  if (shadowsFog && light.kind === 'rect')
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: a rect casts no shadow on the fog`, {})
  validated.shadowsFog = shadowsFog
}
