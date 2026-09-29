//! The sampled Hausdorff distance raised to a floor the caller already holds (#977): a sample stops
//! at the first triangle within the floor, so only the samples that can raise the result are
//! measured exactly, and the result is the full measure's raised to the floor, bit for bit.
use super::{one_sided, Grid};

/// `floor.max(distance(pos, a, b))`, bit for bit, at a fraction of its cost; `floor.max(0.0)` when
/// either side is empty.
pub(crate) fn distance_above(pos: &[f32], a: &[u32], b: &[u32], floor: f64) -> f64 {
    if a.is_empty() || b.is_empty() {
        return floor.max(0.0);
    }
    // The first side raises the floor of the second: a sample below it cannot change the max.
    let floor = floor.max(one_sided(pos, a, &Grid::new(pos, b), floor));
    floor.max(one_sided(pos, b, &Grid::new(pos, a), floor))
}
