import { saturate } from '../../../math/src/scalar/reals.ts'
/**
 * The error ramp a diagnostic view paints with, computed here and nowhere else. Pure arithmetic, so
 * a view can read it without loading the boundary that builds host objects.
 */

/** Error is measured in screen pixels; green is exact, yellow approaches the cut threshold, red exceeds it. */
export function screenErrorRatio(error: number, threshold: number) {
  if (!(error > 0)) return 0
  if (!Number.isFinite(error) || !(threshold > 0)) return 1
  return saturate(error / threshold)
}
