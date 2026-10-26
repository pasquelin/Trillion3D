import {
  DYNAMIC_RESOLUTION_RULES,
  type DynamicResolutionField,
} from '../contracts/dynamicResolutionOptions.ts'

/** The default of a dynamic resolution setting, for its meaning's text. */
const dflt = (field: DynamicResolutionField) => DYNAMIC_RESOLUTION_RULES[field].default

/** What each setting of the dynamic resolution means (`../contracts/dynamicResolutionOptions.ts`):
 *  they apply where the render scale is 'auto', and fit the cut's edge scale (`cutEdgeScaleBudgetMs`)
 *  beside it. The render scale's bounds are the page's `renderScale`. */
export const DYNAMIC_RESOLUTION_MEANINGS: Readonly<Record<DynamicResolutionField, string>> =
  /* @__PURE__ */ (() => ({
    dynamicResolutionFrameTimeBudgetMs: `The frame's GPU time budget the render scale is fitted to, in milliseconds (default ${dflt('dynamicResolutionFrameTimeBudgetMs')}, thirty frames a second). 0 is the page's frame cap interval, the display's refresh unless the page caps the frame rate; any other finite number above 0 is that budget. Any other value is refused.`,
    dynamicResolutionThrottlingMaxPercent: `The most the render scale may be, in percent of the display, from 0 to 100 (default ${dflt('dynamicResolutionThrottlingMaxPercent')}, none), within the page's renderScale bounds, whatever the budget allows: to hold the power a page draws while idle without resizing its targets. Any other value is refused.`,
    dynamicResolutionHeadroomPercent: `The share of the budget the fit leaves free, in percent from 0 to 99 (default ${dflt('dynamicResolutionHeadroomPercent')}): the margin for a frame's noise. Any other value is refused.`,
    dynamicResolutionOverBudgetHeadroomPercent: `The share of the budget a frame must take to count as over it, in percent from 0 to 99 (default ${dflt('dynamicResolutionOverBudgetHeadroomPercent')}): the budget is reduced by it. Any other value is refused.`,
    dynamicResolutionHistorySize: `The GPU times the fit keeps, a whole number from 1 to 4096 (default ${dflt('dynamicResolutionHistorySize')}). Any other value is refused.`,
    dynamicResolutionFrameWeightExponent: `The weight of each frame back against the one after it, a finite number of at least 0 (default ${dflt('dynamicResolutionFrameWeightExponent')}): the newest frames count most. Any other value is refused.`,
    dynamicResolutionChangePeriod: `The fewest GPU times between two changes of the resolution, a whole number of at least 0 (default ${dflt('dynamicResolutionChangePeriod')}): it keeps the temporal upsampling's jitter from interfering. A history all over its budget changes it at once. Any other value is refused.`,
    dynamicResolutionIncreaseAmortization: `How far a rise of the resolution goes at once, from 0 to 1 (default ${dflt('dynamicResolutionIncreaseAmortization')}): a rise is cautious, a drop is not. Any other value is refused.`,
    dynamicResolutionChangePercentThreshold: `The change, in percent from 0 to 100 (default ${dflt('dynamicResolutionChangePercentThreshold')}), under which the render scale does not move unless it reaches a bound. Any other value is refused.`,
    dynamicResolutionMaxOverBudgetFrames: `The frames in a row over the budget past which the older ones no longer count, a whole number of at least 0 read no lower than 2 (default ${dflt('dynamicResolutionMaxOverBudgetFrames')}). Any other value is refused.`,
    dynamicResolutionUseCpuTimeLogic: `Whether a frame whose CPU time — the engine's own time for the image, the one thread's — passes the budget, or the budget less its headroom, is left out of the frames over budget by their GPU time, since a lower resolution would not shorten it; false by default.`,
  }))()
