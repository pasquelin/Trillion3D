//! JavaScript's `Math.min`, `Math.max` and `Math.hypot`, to the bit, for every kernel that must
//! give JavaScript's bits.
//!
//! JavaScript's `Math.min` and `Math.max` are not Rust's `f64::min` and `f64::max`: the former
//! propagate NaN where the latter discard it, and JavaScript distinguishes `-0` from `+0` where
//! Rust does not promise to. Both are rewritten here, with `Math.hypot`.

/// `Math.min`: NaN contaminates, and `-0` wins over `+0`. That is IEEE-754-2019 `minimum`, which
/// Rust's `f64::min` is NOT — that one is `minNum`, which discards a NaN instead of propagating it —
/// and which `f64::minimum` will be once it leaves nightly. Meanwhile, the comparison first: on
/// ordinary coordinates, one of the first two tests answers, and the rest costs nothing.
#[inline]
pub fn js_min(a: f64, b: f64) -> f64 {
    if a < b {
        a
    } else if b < a {
        b
    } else if a == b {
        // Equal: only `-0` versus `+0` remains to be distinguished, and JavaScript returns `-0`.
        if a.is_sign_negative() {
            a
        } else {
            b
        }
    } else {
        // No comparison is true: one of the two is NaN, and `Math.min` propagates it.
        f64::NAN
    }
}

/// `Math.max`: NaN contaminates, and `+0` wins over `-0`. IEEE-754-2019 `maximum`.
#[inline]
pub fn js_max(a: f64, b: f64) -> f64 {
    if a > b {
        a
    } else if b > a {
        b
    } else if a == b {
        if a.is_sign_positive() {
            a
        } else {
            b
        }
    } else {
        f64::NAN
    }
}

/// The squares of `values` summed in order with Kahan compensation: each step takes back from the
/// next square what the rounding of the running sum lost.
#[inline]
pub fn compensated_squares<const N: usize>(values: [f64; N]) -> f64 {
    let (mut sum, mut compensation) = (0.0f64, 0.0f64);
    for value in values {
        let summand = value * value - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum
}

/// `Math.hypot` of `values` to the bit (`hypot2`, `hypot3`, `hypot4` of
/// `packages/math/src/float/hypot.ts`): every magnitude divided by the largest, the
/// squares summed with compensation, the root scaled back; an infinity before a NaN. The
/// specification leaves `Math.hypot` approximated; this is the rounding Chrome and Node return,
/// where a plain `sqrt` of the squares differs in the last bit on a large share of inputs. The
/// compensation's first step is exact, so two values are the plain sum of their two squares.
pub fn hypot<const N: usize>(values: [f64; N]) -> f64 {
    let magnitudes = values.map(f64::abs);
    // `f64::max` passes over a NaN, as `Math.hypot` takes the largest of the others.
    let max = magnitudes.into_iter().fold(0.0, f64::max);
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if magnitudes.iter().any(|v| v.is_nan()) {
        return f64::NAN;
    }
    if max == 0.0 {
        return 0.0;
    }
    compensated_squares(magnitudes.map(|v| v / max)).sqrt() * max
}

#[cfg(test)]
#[path = "js_tests.rs"]
mod tests;
