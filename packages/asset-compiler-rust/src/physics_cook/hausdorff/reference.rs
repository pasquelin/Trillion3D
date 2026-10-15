//! The tests' serial references of the sampled Hausdorff distance: one side at a time, and the
//! one-shot two-sided measure.
use super::{one_sided, Grid, Level0};

/// Largest distance from the samples of the triangles `from` to the triangles `to`; zero if either is empty.
pub(crate) fn one_sided_distance(pos: &[f32], from: &[u32], to: &[u32]) -> f64 {
    if from.is_empty() || to.is_empty() {
        return 0.0;
    }
    one_sided(pos, from, &Grid::new(pos, to), 0.0)
}

/// The sampled Hausdorff distance between two triangle sets over the same positions: a one-shot
/// `Level0`.
pub(crate) fn distance(pos: &[f32], a: &[u32], b: &[u32]) -> f64 {
    Level0::new(pos, a).distance(b)
}
