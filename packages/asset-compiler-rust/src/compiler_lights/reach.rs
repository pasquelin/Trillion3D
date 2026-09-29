//! How far a punctual light reaches: its published range, shortened as long as no point sees its
//! irradiance move by more than the fixed floor the deduced range already cuts at (#958, CMP-16).
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
//! irradiance moves by more than `RANGE_CUTOFF_IRRADIANCE`, the W/m² floor published in
//! `lights.json` (`units.rangeCutoffIrradiance`). The compiler knows no exposure and no tone curve —
//! the host sets both — so it bounds the pre-exposure irradiance alone; the displayed loss of that
//! bound, per exposure and curve, is measured separately (`preExposureCut.test.ts`). Everything
//! comes from the light: its peak intensity and its range, never a scene. A deduced range has
//! `I/R² = floor`, so it always comes out at the same share of itself (`g(s) = 1`, about 0.774).
use super::*;

/// The shortest range, at most `range`, whose window moves the irradiance of a light of `peak`
/// radiant intensity (W/sr, its strongest channel) by at most the floor anywhere. `g(s) = b`
/// squared is the quadratic `32(a − 1)² = 27b²(a + 1)`: its root above one gives `s = a^(−1/4)`.
pub(crate) fn quantum_reach(range: f64, peak: f64) -> f64 {
    let budget = RANGE_CUTOFF_IRRADIANCE * range * range / peak;
    // An infinite or negative range, an overflowing peak and a NaN have no answer: the range stays.
    if !range.is_finite() || budget.is_nan() || budget <= 0.0 {
        return range;
    }
    let c = 27.0 * budget * budget;
    let a = 1.0 + (c + (c * (256.0 + c)).sqrt()) / 64.0;
    (a.powf(-0.25) * range).max(MIN_RANGE).min(range)
}

/// Shortens a converted light's range in place, once its envelope is known: a light whose
/// `emitterRadius` would no longer sit strictly inside the shortened range keeps its range, so the
/// envelope the contract accepted is never dropped. A directional light has no range to shorten.
pub(crate) fn shorten(entry: &mut Value) {
    let field = |key: &str| entry.get(key).and_then(Value::as_f64);
    let (Some(range), Some(intensity)) = (field("range"), field("intensity")) else {
        return;
    };
    let colour = entry["color"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_f64);
    let reach = quantum_reach(range, intensity * colour.fold(0.0, f64::max));
    if reach > field("emitterRadius").unwrap_or(0.0) {
        entry["range"] = json!(reach);
    }
}
