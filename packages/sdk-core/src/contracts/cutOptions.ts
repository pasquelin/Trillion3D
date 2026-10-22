import {
  ANY_NUMBER as ANY,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings of the GPU cluster cut (`packages/sdk-browser/src/geometry/dag/`): its
 * occlusion in two passes, the culls it makes, how a temporally upscaled image's level of
 * detail follows the display, and how a GPU time budget coarsens its threshold. Run-time settings,
 * as `./settingRules.ts` says. The cut's threshold itself, the pixels per edge, is `pixelError`
 * (`../lod/policy.ts`).
 */

/** What a list's cap takes: a whole number of entries the cut's 32-bit counters and word
 *  addresses still name, two words an entry and every list behind the queues in one table. */
const LIST_ENTRIES: readonly [number, number] = [1, 2147483647]

/** The budget's default, 0: none — a budget of 0 or less turns the edge scale off. */
export const DEFAULT_CUT_EDGE_SCALE_BUDGET_MS = 0
/** The lowest scale's default, 30 % of the screen error's scale. */
export const DEFAULT_CUT_EDGE_SCALE_MIN_PERCENT = 30
/** The lowest scale in percent, from 1 to 100: the reference's own bounds. */
const EDGE_SCALE_PERCENT: readonly [number, number] = [1, 100]

/** The cut's settings by field, each with the reference's default: two passes, every cull on — the
 *  draw distance's one (`cutDrawDistanceCulling`) culls an object that names a distance
 *  (`./objectAbi.ts`, `DRAW_DISTANCE_SETTING`) —, distances at their own size, an upscaled image
 *  cut as its display with no shift, four times finer at most, no GPU time budget for the cut and
 *  its raster (`cutEdgeScaleBudgetMs`), which coarsens the screen error no further than to 30 % of
 *  its scale (`cutEdgeScaleMinPercent`), and lists of 2 Mi nodes, 16 Mi candidate clusters and
 *  4 Mi visible clusters. */
export const CUT_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('cutTwoPassOcclusion', true),
    flag('cutOcclusionCulling', true),
    flag('cutFrustumCulling', true),
    flag('cutMinLodCulling', true),
    flag('cutDrawDistanceCulling', true),
    nonNegative('cutViewDistanceScale', 1),
    // The one setting read once, when the session opens: the project switch that picks the programs'
    // text (`../../../sdk-browser/src/gpu/core/clipDistances.ts`, `clippingFor`).
    flag('cutClipPlane', false),
    flag('cutClipPlaneCulling', true),
    flag('cutViewFiltering', true),
    flag('cutLodBiasFollowsUpscale', true),
    number('cutLodBiasOffset', 0, ANY),
    number('cutLodBiasMin', -2, ANY),
    number('cutEdgeScaleBudgetMs', DEFAULT_CUT_EDGE_SCALE_BUDGET_MS, ANY),
    number('cutEdgeScaleMinPercent', DEFAULT_CUT_EDGE_SCALE_MIN_PERCENT, EDGE_SCALE_PERCENT),
    integer('cutMaxNodes', 2 * 1048576, LIST_ENTRIES),
    integer('cutMaxCandidateClusters', 16 * 1048576, LIST_ENTRIES),
    integer('cutMaxVisibleClusters', 4 * 1048576, LIST_ENTRIES),
  ] as const))()
/** What each quality level below the top writes of `cutViewDistanceScale`, the reference's own
 *  scalability levels: 0.4 at `smooth`, 0.6 at `balanced`, 0.8 at `fine`; `max` writes nothing, the
 *  scale 1 (`../runtime/qualityLevels.ts`). */
export const VIEW_DISTANCE_SCALE_LEVELS = { smooth: 0.4, balanced: 0.6, fine: 0.8 } as const
/** The field of one setting of the cut. */
export type CutField = keyof typeof CUT_RULES
/** The cut's settings as a host writes them, by their fields: each its value, or nothing for its
 *  default. */
export type CutOptions = SettingOptions<typeof CUT_RULES>
