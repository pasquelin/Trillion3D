//! Shared formulas across native compiler stages.
//!
//! Single copy of calculations shared by several stages:
//! same float ops, same order, same precision as original location.
//! Site with detail difference stays local rather than aligned.

pub(crate) mod abi;

pub(crate) use trillion3d_math::linear::{linear_columns, uniform_scale};
pub(crate) use trillion3d_math::vec3::{normalized_or, unit};

/// Padding bytes to reach next multiple of four: zero when already
/// aligned. Alignment binary format requires of views.
pub(crate) fn pad_to_4(length: usize) -> usize {
    (4 - length % 4) % 4
}

/// Elapsed milliseconds from instant: compiler publishes durations in
/// milliseconds only, converting in one place prevents seconds leak.
pub fn elapsed_ms(since: std::time::Instant) -> f64 {
    since.elapsed().as_secs_f64() * 1000.0
}
