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
//! irradiance moves by more than `RANGE_CUTOFF_IRRADIANCE` — the eight-bit floor, after the
//! exposure the host sets, that the deduced range already cuts at. Everything comes from the
//! light: its peak intensity and its range, never a scene. A deduced range has `I/R² = floor`,
//! so it always comes out at the same share of itself (`g(s) = 1`, about 0.774).
use super::*;

/// Shortest range ever published, in metres: a range is never zero.
pub(crate) const MIN_RANGE: f64 = 1e-3;

/// Worst irradiance change, in units of `I/R²`, of shortening a range to the share `s` of itself.
fn worst_change(s: f64) -> f64 {
    let a = s.powi(-4);
    4.0 / 3.0 * (a - 1.0) * (2.0 / (3.0 * (a + 1.0))).sqrt()
}

/// The shortest range, at most `range`, whose window moves the irradiance of a light of `peak`
/// radiant intensity (W/sr, its strongest channel) by at most the floor anywhere.
pub(crate) fn quantum_reach(range: f64, peak: f64) -> f64 {
    let budget = RANGE_CUTOFF_IRRADIANCE * range * range / peak;
    // An overflowing peak leaves no budget and a NaN no answer: the range stays as it is.
    if budget.is_nan() || budget <= 0.0 {
        return range;
    }
    // `g` falls from +∞ at 0 to 0 at 1: bisect for the smallest share it allows. `high` always
    // holds a share that keeps the invariant, so the result does too.
    let (mut low, mut high) = (0.0_f64, 1.0_f64);
    for _ in 0..64 {
        let mid = 0.5 * (low + high);
        if worst_change(mid) <= budget {
            high = mid;
        } else {
            low = mid;
        }
    }
    (high * range).max(MIN_RANGE).min(range)
}
