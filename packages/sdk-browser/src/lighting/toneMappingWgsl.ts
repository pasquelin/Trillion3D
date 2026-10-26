import { TONE_MAPPING_RANK } from '../../../sdk-core/src/scene/core/environment.ts'
import { FILMIC_WGSL } from './filmCurveWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { linearToSrgb } from '../../../math/src/wgsl/color.ts'
import { FINITE_VALUE_WGSL } from './storableWgsl.ts'

const R = TONE_MAPPING_RANK

/**
 * Every display curve a scene may choose (`SceneEnvironment.toneMapping`), picked by its rank:
 * a uniform branch, the same for every pixel of the pass. Each is as follows:
 * - `none` carries the light as it is;
 * - `filmic`, the default, is a film's response in a wide gamut (`filmCurveWgsl.ts`); its method
 *   — the film curve or the standard output transform of the film industry's colour system —
 *   is the colour grading's (`tonemappingMethod`, `./aces/`).
 */
const TONE_MAPPING_WGSL = wgslBlock(
  'TONE_MAPPING_WGSL',
  [FILMIC_WGSL],
  `fn toneMap(color:vec3f,curve:u32)->vec3f{
 switch curve{
  case ${R.none}u:{return color;}
  default:{return filmicCurve(color);}
 }
}`,
)

/** The display value of linear radiance `exposed` (its exposure applied by the caller): the scene's
 *  curve, then the sRGB transfer, a value that is not a number written 0 as the table writes it
 *  (`finiteValue`): a light the curve does not define — a black one — shows black, never undefined. The
 *  chain of the compositions that read no table. */
export const DISPLAY_VALUE_WGSL = wgslBlock(
  'DISPLAY_VALUE_WGSL',
  [TONE_MAPPING_WGSL, linearToSrgb, FINITE_VALUE_WGSL],
  'fn displayValue(exposed:vec3f,curve:u32)->vec3f{return finiteValue(linearToSrgb(toneMap(exposed,curve)));}',
)
