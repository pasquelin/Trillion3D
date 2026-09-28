/**
 * How far a punctual light is worth reaching once the frame's exposure and display curve are known
 * (#958, audit CMP-16): its range, shortened as long as no pixel moves by half a display step.
 *
 * The engine lights a point at distance `d` with `I · w(d, R) / d²`, `w` the range window
 * `(1 − (d/R)⁴)²` (`rangeWindow` of `lighting/direct/lightWgsl.ts` and `webgl/cluster/shaders.ts`).
 * Shortening `R` to `s·R` moves that irradiance by `I/R² · (w(x) − w(x/s)) / x²`, `x = d/R`. Where
 * `x < s` both windows are open and the change is `(a − 1)x²(2 − (a + 1)x⁴)`, `a = s⁻⁴`, whose
 * maximum, at `x⁴ = 2 / (3(a + 1))` (always under `s⁴`), is `g(s) = 4/3 · (a − 1) · √(2/(3(a + 1)))`;
 * past `s` only the old window is left, decreasing, and under that maximum. So the worst change
 * anywhere is exactly `I/R² · g(s)`.
 *
 * Invariant: a reach is never longer than the range it bounds, and the displayed colour of no
 * pixel moves by more than half an eight-bit step (0.5 LSB). The irradiance change times the
 * exposure is a change of the curve's input for a surface whose reflectance is at most one; the
 * display chain — curve, then the sRGB transfer — moves each output by at most its steepest slope
 * (`DISPLAY_SLOPE`) times the largest input change, whatever the other lights put under it.
 */
import type { SceneToneMapping } from '../../scene/core/environment.ts';

/** Half an eight-bit display step, on the output's [0, 1] scale. */
const HALF_STEP = 0.5 / 255;
/** The sRGB transfer's steepest slope: its linear foot, 12.92; its power part stays under it. */
const SRGB_SLOPE = 12.92;
/**
 * The steepest the display chain moves any output channel per unit of any mix of input channels
 * (the ∞-norm of its Jacobian), by curve. `linear`, `none` and `reinhard` act channel by channel
 * with a slope of at most one. ACES (`lighting/toneCurveConstants.ts`) is bounded by the product of
 * its parts: its 1/0.6 exposure scale, its input matrix (rows summing to 1), its rational fit
 * (steepest slope 0.90513, at 0.249) and its output matrix (largest absolute row sum 2.2095):
 * 3.3332, rounded up. A curve left out here — AgX's logarithm is unbounded near black — keeps its
 * ranges as they are.
 */
const DISPLAY_SLOPE: Partial<Record<SceneToneMapping, number>> = {
  none: SRGB_SLOPE,
  linear: SRGB_SLOPE,
  reinhard: SRGB_SLOPE,
  aces: SRGB_SLOPE * 3.334,
};

/** What the frame does to radiance before it is shown: its exposure and its display curve. */
export type Display = { exposure: number; toneMapping: SceneToneMapping };

/**
 * The irradiance change, in W/m², under which no displayed colour moves by 0.5 LSB, or 0 when the
 * display gives no such bound — an unbounded curve, a non-positive or non-finite exposure.
 */
export function irradianceQuantum({ exposure, toneMapping }: Display): number {
  const slope = DISPLAY_SLOPE[toneMapping];
  return slope && exposure > 0 && Number.isFinite(exposure) ? HALF_STEP / (slope * exposure) : 0;
}

/**
 * The shortest reach, at most `range`, at which a light of `peak` radiant intensity (W/sr, its
 * strongest channel) moves no irradiance by more than `quantum`. `g(s) = b`, `b = quantum·R²/peak`,
 * squared is the quadratic `32(a − 1)² = 27b²(a + 1)`: its root above one gives `s = a^(−1/4)`. An
 * infinite range takes the limit, `(32/27)^(1/4) · √(peak/quantum)`. With no quantum, or a peak or
 * range that gives no answer, the range stays as it is.
 */
export function visibleReach(range: number, peak: number, quantum: number): number {
  if (!(quantum > 0) || !(peak > 0) || !(range > 0)) return range;
  if (range === Infinity) {
    const limit = (32 / 27) ** 0.25 * Math.sqrt(peak / quantum);
    return Number.isFinite(limit) ? limit : range;
  }
  const budget = (quantum * range * range) / peak;
  if (!Number.isFinite(budget)) return range;
  const c = 27 * budget * budget;
  const a = 1 + (c + Math.sqrt(c * (256 + c))) / 64;
  const reach = a ** -0.25 * range;
  return reach > 0 && reach < range ? reach : range;
}
