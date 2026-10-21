//! The two precisions the exact predicates run in, and the constants each one's arithmetic is
//! bounded by.
//!
//! A precision of `p` significand bits rounds with a unit roundoff of `2⁻ᵖ` — the largest power of
//! two whose sum with one still rounds back to one, which halving from one reaches first — and
//! splits a float into two halves of `⌈p / 2⌉` bits by multiplying it by `2^⌈p/2⌉ + 1`. Each error
//! bound is a short polynomial in the roundoff (a constant times it, plus a small correction),
//! formed in double precision and then rounded to the predicate's precision — exactly for both,
//! the polynomials' coefficients being small integers.
use trillion3d_math::scalar::real::Real;

/// Double precision's unit roundoff, `2⁻⁵³`.
pub(super) const DOUBLE_ROUNDOFF: f64 = f64::EPSILON * 0.5;
/// Single precision's unit roundoff, `2⁻²⁴`, held in double precision: its error bounds are formed
/// in double precision, then rounded to single precision.
const SINGLE_ROUNDOFF: f64 = f32::EPSILON as f64 * 0.5;

/// `f32` or `f64`, with the constants of its exact arithmetic. Comparisons are IEEE ones: every
/// one against NaN fails.
pub(super) trait Precision: Real + PartialOrd {
    /// `2^⌈p/2⌉ + 1`: a float times it, less the float, keeps the float's high half.
    const SPLITTER: Self;
    /// The relative error of the value a stage returns after adding a correction to it.
    const RESULT_BOUND: Self;
    /// The orientation's first bound, on the once-rounded determinant, relative to the sum of the
    /// magnitudes of its two products.
    const TURN_FILTER_BOUND: Self;
    /// The orientation's second bound, on the determinant of the rounded differences summed
    /// exactly then rounded, relative to the same sum.
    const TURN_ESTIMATE_BOUND: Self;
    /// The orientation's third bound, on the estimate corrected by the differences' first-order
    /// rounding errors, relative to the same sum.
    const TURN_TAIL_BOUND: Self;

    /// `self` when it is not below zero, its negation otherwise: `−0` is returned as it is and NaN
    /// negated, a magnitude every caller only multiplies and compares.
    fn magnitude(self) -> Self {
        if self >= Self::ZERO {
            self
        } else {
            -self
        }
    }
}

/// The constants of `$float`, whose unit roundoff (held in double precision) is `$roundoff` and
/// whose splitter is `$splitter`; every bound is formed in double precision and then rounded.
macro_rules! precision {
    ($float:ty, $roundoff:expr, $splitter:expr) => {
        impl Precision for $float {
            const SPLITTER: $float = $splitter;
            const RESULT_BOUND: $float = ((3.0 + 8.0 * $roundoff) * $roundoff) as $float;
            const TURN_FILTER_BOUND: $float = ((3.0 + 16.0 * $roundoff) * $roundoff) as $float;
            const TURN_ESTIMATE_BOUND: $float = ((2.0 + 12.0 * $roundoff) * $roundoff) as $float;
            const TURN_TAIL_BOUND: $float =
                ((9.0 + 64.0 * $roundoff) * $roundoff * $roundoff) as $float;
        }
    };
}
// 53 significand bits: halves of 27 bits.
precision!(f64, DOUBLE_ROUNDOFF, 134_217_729.0);
// 24 significand bits: halves of 12 bits.
precision!(f32, SINGLE_ROUNDOFF, 4_097.0);
