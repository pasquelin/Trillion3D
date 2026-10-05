/** The approximations the reference switches off, by name (`referenceMode.ts`). */
export const REFERENCE_APPROXIMATIONS = [
  'renderScale',
  'temporalReuse',
  'probeBudget',
  'shadowResolution',
  'supersampling',
  'reflectionTrace',
] as const;

/** The bounce target of the reference mode, in milliseconds: far past any frame, so the budget never
 *  lowers the probes traced below their per-frame ceiling (`createBounceBudget`). */
export const REFERENCE_BOUNCE_BUDGET_MS = 1000;
