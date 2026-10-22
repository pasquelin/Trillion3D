import { fieldsOf, refusal } from '../../contracts/nameMatch.ts'
import {
  ANY_NUMBER as ANY,
  flagSetting as flag,
  numberSetting as number,
  resolveSettings,
  rulesOf,
  type SettingOptions,
  type SettingValues,
  vectorSetting as vector,
} from '../../contracts/settingRules.ts'

/**
 * The sun's light shafts, the sky module's: two effects of one machinery. The OCCLUSION darkens
 * the fog's inscattering (the haze, the volume and the fog together) where something near the eye
 * hides the light's direction; the BLOOM blurs the scene's bright colour away from the light and
 * adds it back onto the image. Both are drawn at a reduced size (`lightShaftDownsample`,
 * `./quality.ts`, with the switch `lightShafts`), blurred radially toward the light by the passes
 * and the first distance `./quality.ts` holds, by a directional light only. Run-time settings, as `../../contracts/settingRules.ts` says. Distances
 * are in metres.
 */

/** The samples of one radial blur pass: fixed, the renderer's value is read only. */
export const LIGHT_SHAFT_BLUR_SAMPLES = 12

/** The distance of the shafts' light from the eye along its direction, in metres: the renderer
 *  puts it at the largest world extent. */
export const LIGHT_SHAFT_LIGHT_DISTANCE = 87960930222.08

/**
 * The settings of a light by field (the light component's, with its defaults):
 * - `shaftOcclusion` (false): the light darkens the fog's inscattering; the base level turns it on
 *   for the sun;
 * - `shaftOcclusionDarkness` (0.05): what an occlusion of 0 maps to, 1 darkening nothing;
 * - `shaftOcclusionDepthRange` (1000): everything closer to the eye than this distance
 *   occludes the shafts;
 * - `shaftOverrideDirection` (0, 0, 0): when not nil, the direction the shafts come from instead of
 *   the light's own, normalised where it is used;
 * - `shaftBloom` (false): the light adds a bloom;
 * - `shaftBloomScale` (0.2): the factor on the added colour;
 * - `shaftBloomThreshold` (0): the brightness the image must pass, after exposure, to bloom;
 * - `shaftBloomMaxBrightness` (100): a brightness above it, after exposure, is brought down to it;
 * - `shaftBloomTint` (white, linear): the factor on the bloom's colour.
 * None of them is limited; the shader takes the inverse of the depth range.
 */
export const LIGHT_SHAFT_LIGHT_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('shaftOcclusion', false),
    number('shaftOcclusionDarkness', 0.05, ANY),
    number('shaftOcclusionDepthRange', 1000, ANY),
    vector('shaftOverrideDirection', [0, 0, 0]),
    flag('shaftBloom', false),
    number('shaftBloomScale', 0.2, ANY),
    number('shaftBloomThreshold', 0, ANY),
    number('shaftBloomMaxBrightness', 100, ANY),
    vector('shaftBloomTint', [1, 1, 1]),
  ] as const))()

export type LightShaftLightOptions = SettingOptions<typeof LIGHT_SHAFT_LIGHT_RULES>
export type LightShaftLight = SettingValues<typeof LIGHT_SHAFT_LIGHT_RULES>

/** The light's settings, each its default when the fields hold none.
 *  @throws TypeError naming a field the light does not have, or a value a field does not take. */
export const resolveLightShaftLight = (fields: Readonly<Record<string, unknown>>) =>
  resolveSettings(
    LIGHT_SHAFT_LIGHT_RULES,
    fieldsOf(
      fields,
      Object.keys(LIGHT_SHAFT_LIGHT_RULES),
      'the light shafts of a light',
      refusal('light shafts'),
    ),
  )

/** The direction the shafts come from: the override when it is not nil, else `direction`, the
 *  light's own (from the light toward the scene, as it shines), unit or not. */
export function lightShaftDirection(
  light: LightShaftLight,
  direction: readonly [number, number, number],
) {
  const [x, y, z] = light.shaftOverrideDirection
  const squared = x * x + y * y + z * z
  if (!(squared > 0)) return direction
  const length = Math.sqrt(squared)
  return [x / length, y / length, z / length] as const
}
