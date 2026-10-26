import { EngineError } from '../../contracts/cache.ts'
import { isFiniteNumber } from '../../../../math/src/scalar/reals.ts'
import { DEG2RAD } from '../../../../math/src/constants.ts'
import type { SceneLight } from './contracts.ts'

/**
 * The defaults of a light's light function, the reference's, in the engine's metres: the scale
 * 1024 cm (10.24 m) a side, the fade distance 100000 cm (1 km), the brightness of a light whose
 * light function is disabled or faded out one half, and no cone for a rectangle.
 */
export const LIGHT_FUNCTION_DEFAULTS = {
  scale: [10.24, 10.24, 10.24],
  fadeDistance: 1000,
  disabledBrightness: 0.5,
  coneAngle: 0,
} as const

/** The widest cone, in degrees, a rectangle's light function opens: the reference clamps to it. */
const LIGHT_FUNCTION_CONE_LIMIT = 89

/** The kinds of light a light function exists for besides the rectangle's cone: all of them. */
const FIELDS = [
  'lightFunctionScale',
  'lightFunctionFadeDistance',
  'lightFunctionDisabledBrightness',
  'lightFunctionConeAngle',
] as const

/** The scale of a light's light function, in metres. */
export const lightFunctionScaleOf = (light: SceneLight): readonly [number, number, number] =>
  light.lightFunctionScale ?? LIGHT_FUNCTION_DEFAULTS.scale
/** The distance, in metres, past which a light's light function has faded to its disabled brightness. */
export const lightFunctionFadeOf = (light: SceneLight) =>
  light.lightFunctionFadeDistance ?? LIGHT_FUNCTION_DEFAULTS.fadeDistance
/** The brightness a light has where its light function is disabled or faded out. */
export const lightFunctionDisabledOf = (light: SceneLight) =>
  light.lightFunctionDisabledBrightness ?? LIGHT_FUNCTION_DEFAULTS.disabledBrightness
/** The tangent of a rectangle's light function cone, 0 for none: the cone clamped to the limit. */
export const lightFunctionConeTangentOf = (light: SceneLight) => {
  const degrees = light.lightFunctionConeAngle ?? LIGHT_FUNCTION_DEFAULTS.coneAngle
  return degrees > 0 ? Math.tan(Math.min(degrees, LIGHT_FUNCTION_CONE_LIMIT) * DEG2RAD) : 0
}

const bad = (id: string, what: string, value: unknown) =>
  new EngineError('INVALID_SCENE_LIGHT', `${id}: ${what}`, { value })

/** The scale, fade distance and disabled brightness of a light function, validated into `validated`
 *  where the light sets them. */
function validateLightFunctionNumbers(light: SceneLight, validated: SceneLight) {
  const { id } = light
  const { lightFunctionScale: scale, lightFunctionFadeDistance: fade } = light
  if (scale !== undefined) {
    if (
      !Array.isArray(scale) ||
      scale.length !== 3 ||
      !scale.every((s) => isFiniteNumber(s) && s > 0)
    )
      throw bad(id, 'lightFunctionScale expects three numbers above 0', scale)
    validated.lightFunctionScale = [scale[0], scale[1], scale[2]]
  }
  if (fade !== undefined) {
    if (!isFiniteNumber(fade) || fade <= 0)
      throw bad(id, 'lightFunctionFadeDistance must be > 0', fade)
    validated.lightFunctionFadeDistance = fade
  }
  const dark = light.lightFunctionDisabledBrightness
  if (dark !== undefined) {
    if (!isFiniteNumber(dark) || dark < 0)
      throw bad(id, 'lightFunctionDisabledBrightness must be >= 0', dark)
    validated.lightFunctionDisabledBrightness = dark
  }
}

/** The light function fields of a light, validated into `validated`: a material's id, and, only
 *  beside it, a scale of three numbers above 0, a fade distance above 0, a disabled brightness of at
 *  least 0 and, for a rectangle, a cone angle of at least 0 degrees. A field a light cannot use is
 *  refused, never accepted then ignored. */
export function validateLightFunction(light: SceneLight, validated: SceneLight) {
  const { id } = light
  if (light.lightFunction === undefined) {
    for (const field of FIELDS)
      if (light[field] !== undefined)
        throw bad(id, `${field} exists only beside a lightFunction`, light[field])
    return
  }
  if (typeof light.lightFunction !== 'string' || !light.lightFunction)
    throw bad(id, 'lightFunction expects a material id', light.lightFunction)
  validated.lightFunction = light.lightFunction
  validateLightFunctionNumbers(light, validated)
  const cone = light.lightFunctionConeAngle
  if (cone === undefined) return
  if (light.kind !== 'rect') throw bad(id, 'lightFunctionConeAngle exists only for a rect', cone)
  if (!isFiniteNumber(cone) || cone < 0) throw bad(id, 'lightFunctionConeAngle must be >= 0', cone)
  validated.lightFunctionConeAngle = cone
}
