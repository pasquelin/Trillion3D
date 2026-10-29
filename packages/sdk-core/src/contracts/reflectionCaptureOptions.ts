import {
  flagSetting as flag,
  integerSetting as integer,
  positiveSetting as positive,
  readSetting,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * THE REFLECTION CAPTURES' SETTINGS: how the captures of the scene (`../scene/reflectionCapture/contracts.ts`) are made
 * and read. Run-time settings, as `./settingRules.ts` says; the quality levels write none of them, and each default is the
 * reference's.
 *
 * - `reflectionCaptures` (on): the captures light the surfaces; off, none is made nor read;
 * - `reflectionCaptureResolution` (128, a power of two from 16 to 1024, the nearest below is taken): the side of every capture's cube;
 * - `reflectionCaptureSupersample` (1, from 1 to 8): the scene is drawn at this many times the cube's side, then reduced;
 * - `reflectionCaptureNearPlane` (0.05 m): the nearest distance the capture draws;
 * - `reflectionCaptureLightFunctions` (off): the lights' functions show in the captures;
 * - `reflectionCaptureDiffuse` (off): the cubes' four smallest mips hold the diffuse light of the capture, and the surfaces
 *   take their diffuse light from the captures where they reach, in place of the sky light's;
 * - `reflectionCaptureDiffuseReference` (on): that diffuse light is the exhaustive convolution of the cube; off, it is
 *   evaluated from nine harmonics summed from the cube.
 */
export const REFLECTION_CAPTURE_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('reflectionCaptures', true),
    integer('reflectionCaptureResolution', 128, [16, 1024]),
    integer('reflectionCaptureSupersample', 1, [1, 8]),
    positive('reflectionCaptureNearPlane', 0.05),
    flag('reflectionCaptureLightFunctions', false),
    flag('reflectionCaptureDiffuse', false),
    flag('reflectionCaptureDiffuseReference', true),
  ] as const))()

/** The field of one reflection capture setting. */
export type ReflectionCaptureField = keyof typeof REFLECTION_CAPTURE_RULES
/** The reflection capture settings as a host writes them: each its value, or nothing for its default. */
export type ReflectionCaptureOptions = SettingOptions<typeof REFLECTION_CAPTURE_RULES>
/** The reflection capture settings, every field set. */
export type ReflectionCaptureSettings = SettingValues<typeof REFLECTION_CAPTURE_RULES>

/** The side of a capture's cube: the setting held to the power of two at or below it. */
export const reflectionCaptureSide = (
  settings: Pick<ReflectionCaptureSettings, 'reflectionCaptureResolution'>,
) => 2 ** Math.floor(Math.log2(settings.reflectionCaptureResolution))

/** The reflection capture settings of a runtime's context: every field, its default where the context holds none. */
export const readReflectionCaptureSettings = (runtime: {
  readonly context: ReflectionCaptureOptions
}): ReflectionCaptureSettings =>
  Object.fromEntries(
    Object.keys(REFLECTION_CAPTURE_RULES).map((field) => [
      field,
      readSetting(REFLECTION_CAPTURE_RULES, runtime.context, field as ReflectionCaptureField),
    ]),
  ) as ReflectionCaptureSettings
