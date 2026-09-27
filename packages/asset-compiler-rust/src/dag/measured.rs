//! The error a group reduction publishes (#929).
//!
//! meshoptimizer's quadric error, attributes weighed in, estimates how far the kept surface moves;
//! on a curved surface it under-measures the chord sag (0.6 times the sampled Hausdorff distance
//! on a sphere: a cut at a 1 px threshold drew 1.39 px of error). The published error is therefore
//! never below the geometry's own, the sampled two-sided Hausdorff distance between the group's
//! children and its outputs: the same vertex, edge-midpoint and centroid sampling as the physics
//! cook's collision distance (`physics_cook/hausdorff.rs`).
//!
//! Measuring every sample exactly multiplied the DAG build time by 3 to 11. Only the samples that
//! can raise the error are measured exactly: a sample stops at the first triangle within the bound
//! the quadrics, the children and the removed parts already give (`distance_above`), which returns
//! the same error bit for bit.
use super::GroupReductionInput;
use crate::physics_cook::hausdorff::distance_above;

/// The error of reducing `live` to `kept`: the largest of the quadrics' estimate `qem`, the
/// children's error, what the parts removed whole cost (`vanished.rs`) and the sampled Hausdorff
/// distance between `live` and `kept`. A bound that is not finite is returned unmeasured, for the
/// caller to refuse.
pub(super) fn step_error(
    input: &GroupReductionInput,
    live: &[u32],
    kept: &[u32],
    qem: f64,
    child_error: f64,
) -> f64 {
    let (positions, weld, extents) = (input.positions, input.weld, input.extents);
    let vanished = super::vanished::vanished_error(live, kept, positions, weld, extents);
    let bound = vanished.max(qem.max(child_error));
    if !bound.is_finite() {
        return bound;
    }
    distance_above(positions, live, kept, bound)
}
