//! The two scales of stretch: the caller's, from 0 (no distortion allowed) to 1 (any), and the
//! partition's own, the mean squared L² stretch, 1 for an isometric map and growing without bound.
//!
//! A caller's stretch `s` becomes the bound `1 / (1 − s)`; with a signal, `1 / (1 − s^0.2)`, which
//! leaves the signal's optimisation more room. A bound at zero distance from one side becomes the
//! largest float, as does any larger bound.
use super::util::near_zero;

/// With a signal, the caller's stretch is raised to this power before it becomes a bound.
const SIGNAL_POWER: f32 = 0.2;

/// The caller's stretch from which a chart of one boundary may be laid flat by barycentric
/// coordinates: when the stretch bound is at least this one's.
pub(crate) const BARYCENTRIC_STRETCH: f32 = 0.95;

/// The largest internal bound.
const MAX_BOUND: f32 = f32::MAX;

/// The partition's bound for the caller's stretch `stretch`, in `[0, 1]`.
pub(crate) fn internal_criterion(stretch: f32, signal: bool) -> f32 {
    let left = if signal {
        1.0 - stretch.powf(SIGNAL_POWER)
    } else {
        1.0 - stretch
    };
    if near_zero(left) {
        return MAX_BOUND;
    }
    let bound = 1.0 / left;
    if bound > MAX_BOUND {
        MAX_BOUND
    } else {
        bound
    }
}
