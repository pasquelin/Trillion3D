/**
 * How far a punctual lamp is worth reaching once the frame's exposure and display curve are known
 * (#958, CMP-16): its authored range — the Unreal `AttenuationRadius`, a first-class control no
 * scene tunes — shortened while its own contribution stays under half a display step after the
 * tone curve.
 *
 * The engine lights a point at distance `d` with `I · w(d, R) / d²`, `w` the range window
 * `(1 − (d/R)⁴)²` (`rangeWindow`, `lighting/direct/lightWgsl.ts`, `webgl/cluster/shaders.ts`).
 * Shortening `R` to `s·R` moves that irradiance by `I/R² · (w(x) − w(x/s)) / x²`, `x = d/R`. Where
 * both windows are open the change is `(a − 1)x²(2 − (a + 1)x⁴)`, `a = s⁻⁴`, largest at
 * `x⁴ = 2 / (3(a + 1))` (under `s⁴`): `g(s) = 4/3 · (a − 1) · √(2/(3(a + 1)))`; past `s` only the
 * old window is left, decreasing, and under it. So the worst change anywhere is `I/R² · g(s)`.
 *
 * Invariant: a reach is never longer than the authored range, and no displayed colour moves by
 * `PERCEPTUAL_STEP`. The surface turns an irradiance change into radiance at most
 * `brdfBound(roughness)` times over: the diffuse lobe at albedo one plus the specular lobe at the
 * scene's OWN roughness — never the worst case at `ROUGHNESS_FLOOR`, a mirror no real scene
 * shades, whose `1/(2π α³)` peak bounded a 100 W/sr lamp only past ~4000 km (#958, `958-light-reach`).
 * The display chain — exposure, curve, sRGB transfer — moves an output at most `DISPLAY_SLOPE`
 * times the largest input change, whatever the other lights put under it. Bloom and every effect
 * after the curve read that displayed colour, so they inherit the bound.
 */
import type { SceneEnvironment } from '../../../../sdk-core/src/scene/core/environment.ts';
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts';
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts';

/** Half an eight-bit display step, on the output's [0, 1] scale (CMP-16's equivalence: 0.5 LSB
 *  after tone mapping). */
const PERCEPTUAL_STEP = 0.5 / 255;
/** The sRGB transfer's steepest slope: its linear foot, 12.92; its power part stays under it. */
const SRGB_SLOPE = 12.92;
/**
 * The steepest the display curve and the sRGB transfer move an output channel per unit of any mix
 * of input channels. `none`, `linear` and `reinhard` act channel by channel, slope at most one.
 * ACES (`lighting/toneCurveConstants.ts`): its 1/0.6 scale, its input rows summing to one, its
 * rational fit's steepest slope 0.90513 and its output's largest row sum 2.2095 give 3.3332,
 * rounded up. The other curves — AgX's logarithm is unbounded near black — keep their ranges.
 */
const DISPLAY_SLOPE: Partial<Record<Display['toneMapping'], number>> = {
  none: SRGB_SLOPE,
  linear: SRGB_SLOPE,
  reinhard: SRGB_SLOPE,
  aces: SRGB_SLOPE * 3.334,
};

/** What the frame does to radiance before it is shown: its exposure and its display curve. */
export type Display = Required<Pick<SceneEnvironment, 'exposure' | 'toneMapping'>>;

/** The smoothest roughness any shading path draws, as a number (`ROUGHNESS_FLOOR` is shader text). */
const FLOOR = Number(ROUGHNESS_FLOOR);

/**
 * The most radiance a unit irradiance on the light's axis gives back, times the cosine, on a
 * surface of `roughness`: Lambert's `1/π` at albedo one, plus the GGX peak `1/(2π α³)` with
 * Fresnel at one and `α = roughness²`. `roughness` absent or below the floor takes the floor, the
 * conservative end; a rougher surface gives less, so a rougher scene reaches farther.
 */
export function brdfBound(roughness: number | undefined): number {
  const alpha = Math.max(roughness ?? FLOOR, FLOOR) ** 2;
  return 1 / Math.PI + 1 / (2 * Math.PI * alpha ** 3);
}

/**
 * The irradiance change, in W/m², under which no displayed colour moves by `PERCEPTUAL_STEP`, or 0
 * when the display gives no bound. The frame's own exposure is taken as-is: a reach is re-derived
 * whenever the exposure changes, so a rise lengthens it at once and the edge never pops.
 */
export function irradianceQuantum({ exposure, toneMapping }: Display, roughness?: number): number {
  const slope = DISPLAY_SLOPE[toneMapping];
  return slope && exposure > 0 && Number.isFinite(exposure)
    ? PERCEPTUAL_STEP / (slope * exposure * brdfBound(roughness))
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

/** Shortens a point or spot record's range in place to its visible reach; a lamp whose emitter
 *  the shorter range would no longer hold keeps its range. A rectangle's radiance is not `I/d²`. */
export function boundReach(record: SceneLight, quantum: number) {
  if (record.range === undefined || record.kind === 'rect') return;
  const reach = visibleReach(record.range, record.intensity * Math.max(...record.color), quantum);
  if (reach > (record.emitterRadius ?? 0)) record.range = reach;
}
