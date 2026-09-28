//! How far a punctual light reaches: its range, shortened as long as no point sees its light move
//! by more than the display floor (#958, audit CMP-16).
//!
//! The engine lights a point at distance `d` with `I · range_window(d, R) / d²`
//! (`shared_math::range_window`). Shortening `R` to `s·R` moves that irradiance by
//! `I/R² · (w(x) − w(x/s)) / x²`, with `x = d/R`. Where `x < s` both windows are open and the
//! change is the polynomial `2x²(a − 1) − x⁶(a² − 1)`, `a = s⁻⁴`, whose maximum, at
//! `x⁴ = 2 / (3(a + 1))` (always under `s⁴`), is `g(s) = 4/3 · (a − 1) · √(2 / (3(a + 1)))`; past
//! `s` only the old window is left, decreasing, and under that maximum. So the worst change
//! anywhere is exactly `I/R² · g(s)`.
//!
//! Invariant: the published range is never longer than the one it bounds, and no point's
//! irradiance moves by more than `RANGE_CUTOFF_IRRADIANCE` — the floor the deduced range already
//! cuts at, published in `lights.json` (`units.rangeCutoffIrradiance`). The host sets exposure,
//! never import: the compiler takes that published floor as the post-exposure quantum. Everything
//! else comes from the light: its peak intensity and its range, never a scene. A deduced range has `I/R² = floor`,
//! so it always comes out at the same share of itself (`g(s) = 1`, about 0.774).
use super::*;

/// The shortest range, at most `range`, whose window moves the irradiance of a light of `peak`
/// radiant intensity (W/sr, its strongest channel) by at most the floor anywhere. `g(s) = b`
/// squared is the quadratic `32(a − 1)² = 27b²(a + 1)`: its root above one gives `s = a^(−1/4)`.
pub(crate) fn quantum_reach(range: f64, peak: f64) -> f64 {
    let budget = RANGE_CUTOFF_IRRADIANCE * range * range / peak;
    // An overflowing peak leaves no budget and a NaN no answer: the range stays as it is.
    if budget.is_nan() || budget <= 0.0 {
        return range;
    }
    let c = 27.0 * budget * budget;
    let a = 1.0 + (c + (c * (256.0 + c)).sqrt()) / 64.0;
    (a.powf(-0.25) * range).max(MIN_RANGE).min(range)
}
