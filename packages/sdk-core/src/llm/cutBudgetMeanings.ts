import {
  DEFAULT_CUT_EDGE_SCALE_BUDGET_MS,
  DEFAULT_CUT_EDGE_SCALE_MIN_PERCENT,
  type CutField,
} from '../contracts/cutOptions.ts'

/** The settings of the cut that govern the GPU time budget (`../contracts/cutOptions.ts`). */
export type CutBudgetField = Extract<CutField, 'cutEdgeScaleBudgetMs' | 'cutEdgeScaleMinPercent'>

/** What each of them means. */
export const CUT_BUDGET_MEANINGS: Readonly<Record<CutBudgetField, string>> = {
  cutEdgeScaleBudgetMs: `GPU time, in milliseconds, the cut and the raster — the passes that build the visibility buffer: selection, partition, Hi-Z and raster, the views drawn beside the main one included — are given (default ${DEFAULT_CUT_EDGE_SCALE_BUDGET_MS}, none; 0 or less is none). Where the render scale is 'auto', the screen error of the cut is coarsened while their time is over the budget and refined again once it is under it: the heuristic of the render scale, with a linear model — the time of the cut scales with the fraction itself, not its square — and 5 % of the budget left free, fitted in the same history, so the two change together. Never coarser than cutEdgeScaleMinPercent of the scale. Any other value is refused.`,
  cutEdgeScaleMinPercent: `The lowest scale, in percent from 1 to 100 (default ${DEFAULT_CUT_EDGE_SCALE_MIN_PERCENT}), the budget cutEdgeScaleBudgetMs takes the screen error of the cut to: its threshold is divided by the scale, so 30 allows up to 3.33 times the pixels per edge. Any other value is refused.`,
}
