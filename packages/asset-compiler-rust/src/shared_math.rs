//! Shared formulas across native compiler stages.
//!
//! Single copy of calculations shared by several stages:
//! same float ops, same order, same precision as original location.
//! Site with detail difference stays local rather than aligned.

pub(crate) mod abi;
use abi::{SPOT_CONE_GAP, SPOT_CONE_LIMIT};
#[cfg(test)]
pub(crate) mod tests;

/// Padding bytes to reach next multiple of four: zero when already
/// aligned. Alignment binary format requires of views.
pub(crate) fn pad_to_4(length: usize) -> usize {
    (4 - length % 4) % 4
}

/// A spot's inner cone half-angle when its light names none: nothing, the whole cone fading.
pub(crate) const DEFAULT_INNER_CONE_ANGLE: f64 = 0.0;

/// The cosines at the outer and inner edge of a spot's cone, from the half-angles it declares: the
/// inner cone held between 0 and the widest cone; the outer one at least a gap past it and at most
/// the widest cone plus that gap (`abi::SPOT_CONE_LIMIT`, `abi::SPOT_CONE_GAP`, printed from the
/// `SceneLight` contract).
pub(crate) fn spot_cosines(inner_angle: f64, outer_angle: f64) -> (f64, f64) {
    let inner = inner_angle.clamp(0.0, SPOT_CONE_LIMIT);
    let outer = outer_angle.clamp(inner + SPOT_CONE_GAP, SPOT_CONE_LIMIT + SPOT_CONE_GAP);
    (outer.cos(), inner.cos())
}

/// Elapsed milliseconds from instant: compiler publishes durations in
/// milliseconds only, converting in one place prevents seconds leak.
pub fn elapsed_ms(since: std::time::Instant) -> f64 {
    since.elapsed().as_secs_f64() * 1000.0
}
