import {
  ANY_NUMBER as ANY,
  flagSetting as flag,
  integerSetting as integer,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings of the GPU cluster cut (`packages/sdk-browser/src/geometry/dag/`): its
 * occlusion in two passes, the culls it makes, and how a temporally upscaled image's level of
 * detail follows the display. Run-time settings, as `./settingRules.ts` says. The cut's threshold
 * itself, the pixels per edge, is `pixelError` (`../lod/policy.ts`).
 */

/** What a list's cap takes: a whole number of entries the cut's 32-bit counters and word
 *  addresses still name, two words an entry and every list behind the queues in one table. */
const LIST_ENTRIES: readonly [number, number] = [1, 2147483647]

/** The cut's settings by field, each with the reference's default: two passes, every cull on, an
 *  upscaled image cut as its display with no shift, four times finer at most, and lists of 2 Mi
 *  nodes, 16 Mi candidate clusters and 4 Mi visible clusters. */
export const CUT_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('cutTwoPassOcclusion', true),
    flag('cutOcclusionCulling', true),
    flag('cutFrustumCulling', true),
    flag('cutMinLodCulling', true),
    flag('cutLodBiasFollowsUpscale', true),
    number('cutLodBiasOffset', 0, ANY),
    number('cutLodBiasMin', -2, ANY),
    integer('cutMaxNodes', 2 * 1048576, LIST_ENTRIES),
    integer('cutMaxCandidateClusters', 16 * 1048576, LIST_ENTRIES),
    integer('cutMaxVisibleClusters', 4 * 1048576, LIST_ENTRIES),
  ] as const))()
/** The field of one setting of the cut. */
export type CutField = keyof typeof CUT_RULES
/** The cut's settings as a host writes them, by their fields: each its value, or nothing for its
 *  default. */
export type CutOptions = SettingOptions<typeof CUT_RULES>
