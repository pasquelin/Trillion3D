import { EngineError } from '../../contracts/cache.ts'
import { isFiniteNumber } from '../../../../math/src/scalar/reals.ts'
import { LIGHT_MOBILITY, type SceneLight } from './contracts.ts'

/**
 * The two options of a light that say how the volumetric fog and the clouds take it, copied onto
 * `validated` when given: `fogScattering`, a number of 0 or more, and `shadowsFog`, a boolean.
 */
export function validateFogFields(light: SceneLight, validated: SceneLight) {
  const { id, fogScattering, shadowsFog } = light
  if (fogScattering !== undefined) {
    if (!isFiniteNumber(fogScattering) || fogScattering < 0)
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
  validated.shadowsFog = shadowsFog
}

/** `mobility`, copied onto `validated` when given: one of `LIGHT_MOBILITY`. */
export function validateMobility(light: SceneLight, validated: SceneLight) {
  const { id, mobility } = light
  if (mobility === undefined) return
  if (!LIGHT_MOBILITY.includes(mobility))
    throw new EngineError(
      'INVALID_SCENE_LIGHT',
      `${id}: mobility expects ${LIGHT_MOBILITY.join(', ')}`,
      { mobility },
    )
  validated.mobility = mobility
}
