//! The two exact predicates of the plane — which side of a line a point lies on (`orient`,
//! `orient_single`) and whether a point lies inside a circle (`in_circle`) — computed by
//! Shewchuk's adaptive predicates ("Adaptive Precision Floating-Point Arithmetic and Fast Robust
//! Geometric Predicates", 1996): the determinant is first rounded once, and returned at once when
//! a bound on its rounding error, scaled by the magnitudes it was formed from, proves its sign;
//! otherwise it is refined in stages, each adding the rounding errors of the step before (exactly
//! as an expansion of non-overlapping floats, `expansion`) until a tighter bound proves the sign,
//! the last stage giving the determinant exactly.
//!
//! The value returned is the one the stage that stopped computed — the rounded determinant, a
//! refined estimate, or the largest component of the exact expansion — never only its sign:
//! callers compare it to zero, take its sign or multiply it. Every operation is an IEEE
//! round-to-nearest one, in the precision of the inputs, and none is fused.
//!
//! The orientation is ported in both precisions (`turn`, generic over `precision::Precision`);
//! the circle test in double precision only (`circle`), single-precision callers widening their
//! points first.
mod circle;
mod expansion;
mod precision;
mod turn;

/// Twice the signed area of the triangle `a`, `b`, `c` in double precision, its sign exact:
/// positive when the three turn counter-clockwise (`c` left of the line from `a` to `b`), negative
/// when they turn clockwise, zero only when they are exactly collinear.
pub(crate) fn orient(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
    turn::orient_adaptive(a, b, c)
}

/// `orient` in single precision: every product, difference, error bound and expansion component
/// is a single-precision float, the bounds formed from single precision's own roundoff.
pub(crate) fn orient_single(a: [f32; 2], b: [f32; 2], c: [f32; 2]) -> f32 {
    turn::orient_adaptive(a, b, c)
}

/// Where `d` lies against the circle through `a`, `b` and `c`, in double precision, its sign
/// exact: when `a`, `b`, `c` turn counter-clockwise, positive inside the circle and negative
/// outside; the signs swap when they turn clockwise; zero only when the four points lie exactly on
/// one circle (or the three on one line with `d`).
pub(crate) fn in_circle(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> f64 {
    circle::in_circle_adaptive(a, b, c, d)
}
