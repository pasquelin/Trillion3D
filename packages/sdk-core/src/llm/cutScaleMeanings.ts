import {
  DEFAULT_CUT_EDGE_SCALE_BUDGET_MS,
  DEFAULT_CUT_EDGE_SCALE_MIN_PERCENT,
  type CutField,
} from '../contracts/cutOptions.ts'

/** The settings of the cut that scale it: its GPU time budget (`cutEdgeScaleBudgetMs`,
 *  `cutEdgeScaleMinPercent`), the secondary view distance scale and the field of view's scale of
 *  the draw distances, and the one that measures an object's draw distance
 *  (`cutDistanceCullToSphereEdge`) (`../contracts/cutOptions.ts`). */
export type CutScaleField = Extract<
  CutField,
  | 'cutDistanceCullToSphereEdge'
  | 'cutEdgeScaleBudgetMs'
  | 'cutEdgeScaleMinPercent'
  | 'cutViewDistanceApplySecondaryScale'
  | 'cutViewDistanceSecondaryScale'
  | 'cutViewDistanceFovMinAngle'
  | 'cutViewDistanceFovMinAngleScale'
  | 'cutViewDistanceFovMaxAngle'
  | 'cutViewDistanceFovMaxAngleScale'
>

/** What each of them means. */
export const CUT_SCALE_MEANINGS: Readonly<Record<CutScaleField, string>> = /* @__PURE__ */ (() => ({
  cutDistanceCullToSphereEdge:
    "Whether the cut measures an object's draw distance (drawDistance) to the edge of the sphere of its bounds — it is drawn while any part of the sphere lies within its distances — or, false, to the centre of its bounds; an object that names perInstance is always measured to its centre. The rays' scene follows it for the farthest distance of an object of its own; the sun's shadow casters are tested at the centre. No effect on an object that names no distance.",
  cutEdgeScaleBudgetMs: `GPU time, in milliseconds, the cut and the raster of the main view — the passes that build the visibility buffer: selection, partition, Hi-Z and raster — are given (default ${DEFAULT_CUT_EDGE_SCALE_BUDGET_MS}, none; 0 or less is none). Where the render scale is 'auto', the screen error of the cut is coarsened while their time is over the budget and refined again once it is under it: the dynamic resolution's heuristic (dynamicResolution* settings), with a linear model — the time of the cut scales with the fraction itself, not its square — and 5 % of the budget left free, fitted in the same history, so the two change together. Never coarser than cutEdgeScaleMinPercent of the scale. Any other value is refused.`,
  cutEdgeScaleMinPercent: `The lowest scale, in percent from 1 to 100 (default ${DEFAULT_CUT_EDGE_SCALE_MIN_PERCENT}), the budget cutEdgeScaleBudgetMs takes the screen error of the cut to: its threshold is divided by the scale, so 30 allows up to 3.33 times the pixels per edge. Any other value is refused.`,
  cutViewDistanceApplySecondaryScale:
    'Whether the secondary view distance scale (cutViewDistanceSecondaryScale) multiplies the draw distances beside cutViewDistanceScale; false by default.',
  cutViewDistanceSecondaryScale:
    "A second scale of the objects' draw distances, a finite number of at least 0 (default 1): an optional scale for a feature or a game mode that opts in. It multiplies them, with cutViewDistanceScale, only while cutViewDistanceApplySecondaryScale is true. The quality presets never write it. Any other value is refused.",
  cutViewDistanceFovMinAngle:
    'The horizontal field of view, in degrees from 0 to 360 (default 45), at and under which the draw distances of the objects of their own are scaled by cutViewDistanceFovMinAngleScale; an orthographic view counts as 0. Between this angle and cutViewDistanceFovMaxAngle the scale blends linearly. Any other value is refused.',
  cutViewDistanceFovMinAngleScale:
    'Scale, a finite number of at least 0 (default 1), the draw distances of the objects of their own are multiplied by at the field of view cutViewDistanceFovMinAngle and under, beside cutViewDistanceScale; instances of an instanced mesh and the HLOD are not affected. With both field of view scales at 1 nothing changes. Any other value is refused.',
  cutViewDistanceFovMaxAngle:
    'The horizontal field of view, in degrees from 0 to 360 (default 90), at and over which the draw distances of the objects of their own are scaled by cutViewDistanceFovMaxAngleScale. Any other value is refused.',
  cutViewDistanceFovMaxAngleScale:
    'Scale, a finite number of at least 0 (default 1), the draw distances of the objects of their own are multiplied by at the field of view cutViewDistanceFovMaxAngle and over, beside cutViewDistanceScale; the one scale at every field of view where it equals cutViewDistanceFovMinAngleScale. Any other value is refused.',
}))()
