//! The error a group reduction publishes.
//!
//! The simplifier's quadric error, attributes weighed in, estimates how far the kept surface moves;
//! on a curved surface it under-measures the chord sag (0.6 times the sampled Hausdorff distance
//! on a sphere: a cut at a 1 px threshold drew 1.39 px of error). The published error is therefore
//! never below the geometry's own, the sampled two-sided Hausdorff distance between the group's
//! children and its outputs: the same vertex, edge-midpoint and centroid sampling as the physics
//! cook's collision distance (`physics_cook/hausdorff.rs`).
//!
//! Measuring every sample exactly multiplied the DAG build time by 3 to 11. Only the samples that
//! can raise the error are measured exactly: a sample stops at the first triangle within the bound
//! the quadrics, the children and the removed parts already give (`Level0::distance`), which returns
//! the same error bit for bit.
//!
//! Nor is it below how far the texture slides across the coarse surface (`texture.rs`).
use crate::physics_cook::hausdorff::Level0;

/// The arrays a reduction's error is measured on: the level's, or a solve's own
/// region with the vertices it placed (`placed::Local::measured`).
pub(super) struct Surface<'a> {
    pub positions: &'a [f32],
    /// Canonical vertex by position.
    pub weld: &'a [u32],
    /// Canonical vertex by position and every texture set: the texture islands.
    pub weld_seam: &'a [u32],
    /// Per vertex, the extent of its part in the source (`vanished::part_extents`).
    pub extents: &'a [f64],
    /// Two floats per vertex per texture set; empty without one.
    pub uv_sets: Vec<&'a [f32]>,
}

/// The error of reducing `live` to `kept`: the largest of the quadrics' estimate `qem`, the
/// children's error, what the parts removed whole cost (`vanished.rs`: their extent here, their
/// distance to `kept` being within the live-to-kept side of the Hausdorff distance), the sampled
/// Hausdorff distance between `live` and `kept`, and their texture deviation. A bound that is not
/// finite is returned unmeasured, for the caller to refuse.
pub(super) fn step_error(
    surface: &Surface,
    live: &[u32],
    kept: &[u32],
    qem: f64,
    child_error: f64,
) -> f64 {
    let vanished = super::vanished::vanished_extent(live, kept, surface.weld, surface.extents);
    let bound = vanished.max(qem.max(child_error));
    if !bound.is_finite() {
        return bound;
    }
    let bound = super::texture::texture_deviation_above(surface, live, kept, bound);
    Level0::new(surface.positions, live).distance(kept, bound)
}
