import {
  contextReader,
  flagSetting as flag,
  integerSetting as integer,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings of the simple lights (`../scene/light/simpleLights.ts`): the lights the host hands to
 * an image that the scene does not hold (a particle's, an effect's). Run-time settings, as `./settingRules.ts` says:
 * no compiler job names them; each is read again at each image, and each default is the reference's.
 *
 * - `allowSimpleLights` (on): whether the simple lights are taken at all; off, an image lights nothing by them;
 * - `hairSimpleLights` (on): whether the hair strands are lit by the simple lights;
 * - `sampledSimpleLights` (1): which simple lights the sampled lighting takes, where a view lights with it: 0 none (the classic pass lights them all), 1 those
 *   whose entry says `allowSampledLighting` (none, unless it does), 2 all.
 */
export const SIMPLE_LIGHT_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('allowSimpleLights', true),
    flag('hairSimpleLights', true),
    integer('sampledSimpleLights', 1, [0, 2]),
  ] as const))()

/** The field of one setting of the simple lights. */
export type SimpleLightField = keyof typeof SIMPLE_LIGHT_RULES
/** The simple lights' settings as a host writes them, by their fields: each its value, or nothing for its default. */
export type SimpleLightOptions = SettingOptions<typeof SIMPLE_LIGHT_RULES>

/** Each frame's reading of one setting of the simple lights from a runtime's context. */
export const readSimpleLightSetting = /* @__PURE__ */ contextReader(SIMPLE_LIGHT_RULES)
