import {
  ANY_NUMBER as ANY,
  flagSetting as flag,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings of the animation the GPU plays: the screen size under which an instanced
 * skinned object is drawn in its rest pose, and how the scene's animation banks play their tracks
 * (`packages/sdk-browser/src/deformation/bankTracks.ts`). Run-time settings, as
 * `./settingRules.ts` says. An object's own screen size, when its job names one, is its
 * `skinnedInstance.animationMinScreenSize` (`./objectOptions.ts`).
 */

/** The animation's settings by field, each with the reference's default: a tenth of the screen
 *  under which an instanced skinned object stops animating — the diameter of its bounds over the
 *  view's height —, the banks' keys blended, the world's own pace. */
export const ANIMATION_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    nonNegative('animationMinScreenSize', 0.1),
    flag('animationBankInterpolation', true),
    number('animationBankTimeScale', 1, ANY),
  ] as const))()
/** The field of one setting of the animation. */
export type AnimationField = keyof typeof ANIMATION_RULES
/** The animation's settings as a host writes them, by their fields: each its value, or nothing for
 *  its default. */
export type AnimationOptions = SettingOptions<typeof ANIMATION_RULES>
