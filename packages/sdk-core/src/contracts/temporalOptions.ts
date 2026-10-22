import { flagSetting as flag, rulesOf, type SettingOptions } from './settingRules.ts'

/**
 * The run-time settings of the temporal pass beside its level (`temporalAntialiasing`,
 * `./materialOptions.ts`): whether it looks for geometry thinner than a pixel. Run-time settings,
 * as `./settingRules.ts` says: the level is the scene's, written in its manifest, while these are
 * the engine's own, read again at each image.
 */

/** The temporal pass's settings by field, each with the reference's default:
 *  `temporalThinGeometry`, off — whether the pass looks for geometry thinner than a pixel, a wire
 *  or a rail the pixels it crosses see on some images and not on others, and relaxes the history's
 *  clamp where it finds it, at the cost of the finding in every image, at any level that runs the
 *  pass. */
export const TEMPORAL_RULES = /* @__PURE__ */ (() =>
  rulesOf([flag('temporalThinGeometry', false)] as const))()
/** The field of one setting of the temporal pass. */
export type TemporalField = keyof typeof TEMPORAL_RULES
/** The temporal pass's settings as a host writes them, by their fields: each its value, or nothing
 *  for its default. */
export type TemporalOptions = SettingOptions<typeof TEMPORAL_RULES>
