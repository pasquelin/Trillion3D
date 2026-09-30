/**
 * How far a punctual lamp is worth reaching once the frame's exposure and display curve are known
 * (#958, CMP-16): its authored range — the Unreal `AttenuationRadius`, a first-class control no
 * scene tunes — shortened to the reach at which its own contribution still shows after the frame's
 * exposure and tone curve. This is the audit's pre-exposure cut, made exposure- and curve-aware: a
 * **declared class-2 change**, held to the human eye by the acceptance session's image proof (mean
 * and p99.9 channel error, mean FLIP against a named reference), not a 0 px one.
 *
 * The engine lights a point at distance `d` with `I · w(d, R) / d²`, `w` the range window
 * `(1 − (d/R)⁴)²` (`rangeWindow`, `lighting/direct/lightWgsl.ts`, `webgl/cluster/shaders.ts`).
 * Shortening `R` to `s·R` moves that irradiance by `I/R² · (w(x) − w(x/s)) / x²`, `x = d/R`. Where
 * both windows are open the change is `(a − 1)x²(2 − (a + 1)x⁴)`, `a = s⁻⁴`, largest at
 * `x⁴ = 2 / (3(a + 1))` (under `s⁴`): `g(s) = 4/3 · (a − 1) · √(2/(3(a + 1)))`; past `s` only the
 * old window is left, decreasing, and under it. So the worst change anywhere is `I/R² · g(s)`.
 *
 * Invariant: a reach is never longer than the authored range, and never shorter than the lamp's
 * emitter. The quantum the change is held to is CMP-16's pre-exposure irradiance floor (the
 * audit's own 0.01 W/m²), made exposure- and curve-aware: divided by the frame's exposure and
 * scaled by the display curve's own steepness, so a rising auto-exposure lengthens the reach at
 * once — no pop — and a flatter curve cuts no deeper than the steeper one.
 */
import type { SceneEnvironment } from '../../../../sdk-core/src/scene/core/environment.ts';
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts';

/** The audit's pre-exposure irradiance floor (W/m², `958-audit-cut` @ `e0c89bb2c`): the cut's
 *  reference under ACES at exposure 1, where it takes a 400 cd lamp authored to 18 m down to
 *  7.7775 m (range −56.79 %, shadow footprint −81.3 %). */
const AUDIT_IRRADIANCE = 1e-2;
/** The sRGB transfer's steepest slope: its linear foot, 12.92; its power part stays under it. */
const SRGB_SLOPE = 12.92;
/**
 * The steepest the display curve and the sRGB transfer move an output channel per unit of any mix
 * of input channels. `none`, `linear` and `reinhard` act channel by channel, slope at most one.
 * ACES (`lighting/toneCurveConstants.ts`): its 1/0.6 scale, its input rows summing to one, its
 * rational fit's steepest slope 0.90513 and its output's largest row sum 2.2095 give 3.3332,
 * rounded up. The steeper the chain, the smaller the irradiance change it shows.
 */
const DISPLAY_SLOPE: Partial<Record<Display['toneMapping'], number>> = {
  none: SRGB_SLOPE,
  linear: SRGB_SLOPE,
  reinhard: SRGB_SLOPE,
  aces: SRGB_SLOPE * 3.334,
};
/** The curve the floor is stated at, ACES's steepest. */
const REFERENCE_SLOPE = DISPLAY_SLOPE['aces']!;

/** What the frame does to radiance before it is shown: its exposure and its display curve. */
export type Display = Required<Pick<SceneEnvironment, 'exposure' | 'toneMapping'>>;

/**
 * The irradiance step the frame's exposure and curve make perceptible: the audit's floor at ACES
 * and exposure 1, divided by the exposure and scaled by the curve's own steepness relative to
 * ACES. A rising exposure lengthens a reach at once, so a fade never steps. With no slope (an
 * unbounded curve) or a non-positive, non-finite exposure it gives 0: the range stays.
 */
export function perceptibleQuantum({ exposure, toneMapping }: Display): number {
  const slope = DISPLAY_SLOPE[toneMapping];
  return slope && exposure > 0 && Number.isFinite(exposure)
    ? AUDIT_IRRADIANCE / (exposure * (REFERENCE_SLOPE / slope))
    : 0;
}

/**
 * The shortest reach, at most `range`, at which a lamp of `peak` radiant intensity (W/sr, its
 * strongest channel) moves no irradiance by more than `quantum`: `g(s) = b = quantum·R²/peak`,
 * squared, is `32(a − 1)² = 27b²(a + 1)`, whose root above one gives `s = a^(−1/4)`. An infinite
 * range takes the limit, `(32/27)^(1/4) · √(peak/quantum)`. With no answer, the range stays.
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
  const reach = (1 + (c + Math.sqrt(c * (256 + c))) / 64) ** -0.25 * range;
  return reach > 0 && reach < range ? reach : range;
}

/** Shortens a point or spot record's range in place to its perceptible reach; a lamp whose emitter
 *  the shorter range would no longer hold keeps its range. A rectangle's radiance is not `I/d²`. */
export function boundReach(record: SceneLight, quantum: number) {
  if (record.range === undefined || record.kind === 'rect') return;
  const reach = visibleReach(record.range, record.intensity * Math.max(...record.color), quantum);
  if (reach > (record.emitterRadius ?? 0)) record.range = reach;
}
