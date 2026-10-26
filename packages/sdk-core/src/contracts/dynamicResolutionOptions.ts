import {
  countSetting as count,
  integerSetting as integer,
  flagSetting as flag,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
  type SettingRange,
} from './settingRules.ts'

/**
 * The run-time settings of the dynamic resolution, the heuristic that fits the render scale — and,
 * beside it, the cut's edge scale (`cutEdgeScaleBudgetMs`, `./cutOptions.ts`) — to a GPU time
 * budget (`packages/sdk-browser/src/frame/scale/dynamicResolution.ts`). The render scale's own
 * bounds are the page's `renderScale` (its minimum 50 % by default). Run-time settings, as
 * `./settingRules.ts` says, read again at each GPU time the frame hands the heuristic.
 */

/** A percent, from 0 to 100. */
const PERCENT: SettingRange = [0, 100]
/** A blend factor, from 0 to 1. */
const BLEND: SettingRange = [0, 1]
/** The GPU times the history keeps: from 1 to 4096 — more than any budget browses, 160 kB of rings at
 *  the most. */
const HISTORY_SIZES: SettingRange = [1, 4096]

/** The dynamic resolution's settings by field, each with the reference's default, in the order the
 *  heuristic reads them:
 *  - `dynamicResolutionFrameTimeBudgetMs`, 33.3, the frame's GPU time budget the render scale is
 *    fitted to, in milliseconds; 0 is the page's frame cap interval, the display's refresh unless
 *    the page caps the frame rate (`packages/sdk-browser/src/frame/cadence.ts`);
 *  - `dynamicResolutionThrottlingMaxPercent`, 0 — none —, the most the render scale may be, in
 *    percent of the display, when above 0, within the page's bounds, whatever the budget allows;
 *  - `dynamicResolutionHeadroomPercent`, 10, the share of the budget left free;
 *  - `dynamicResolutionOverBudgetHeadroomPercent`, 0, the share of the budget a frame must take
 *    to be over it;
 *  - `dynamicResolutionHistorySize`, 16, the GPU times kept, a whole number from 1 to 4096: five
 *    doubles an entry, allocated at the next sample;
 *  - `dynamicResolutionFrameWeightExponent`, 0.9, each frame back weighs this much of the one
 *    after it;
 *  - `dynamicResolutionChangePeriod`, 8, the fewest GPU times between two changes;
 *  - `dynamicResolutionIncreaseAmortization`, 0.9, how far a rise goes at once;
 *  - `dynamicResolutionChangePercentThreshold`, 2, the change under which the render scale does
 *    not move, in percent;
 *  - `dynamicResolutionMaxOverBudgetFrames`, 2, the frames in a row over the budget past which
 *    the older ones no longer count, read no lower than 2;
 *  - `dynamicResolutionUseCpuTimeLogic`, off — a frame the CPU took longer than the budget lets,
 *    or than the budget less its headroom, is not over budget by its GPU time: lowering the
 *    resolution would not shorten it. The CPU time is the engine's own for the image, the one thread's. */
export const DYNAMIC_RESOLUTION_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    nonNegative('dynamicResolutionFrameTimeBudgetMs', 33.3),
    number('dynamicResolutionThrottlingMaxPercent', 0, PERCENT),
    number('dynamicResolutionHeadroomPercent', 10, [0, 99]),
    number('dynamicResolutionOverBudgetHeadroomPercent', 0, [0, 99]),
    integer('dynamicResolutionHistorySize', 16, HISTORY_SIZES),
    nonNegative('dynamicResolutionFrameWeightExponent', 0.9),
    count('dynamicResolutionChangePeriod', 8, 0),
    number('dynamicResolutionIncreaseAmortization', 0.9, BLEND),
    number('dynamicResolutionChangePercentThreshold', 2, PERCENT),
    count('dynamicResolutionMaxOverBudgetFrames', 2, 0),
    flag('dynamicResolutionUseCpuTimeLogic', false),
  ] as const))()
/** The field of one setting of the dynamic resolution. */
export type DynamicResolutionField = keyof typeof DYNAMIC_RESOLUTION_RULES
/** The dynamic resolution's settings as a host writes them, by their fields: each its value, or
 *  nothing for its default. */
export type DynamicResolutionOptions = SettingOptions<typeof DYNAMIC_RESOLUTION_RULES>
