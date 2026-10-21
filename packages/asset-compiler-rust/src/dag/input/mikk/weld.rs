//! Step 1 of the tangent spaces (`mikk.rs`): the weld of the corners.
//!
//! Two corners are one vertex when their positions, normals and texture coordinates are equal on
//! every axis — `-0` and `+0` alike, a value not a number equal to none. The generator welds them
//! through a grid and a split on the widest axis; which corner of a vertex names it changes
//! nothing it computes, every step comparing vertices for equality alone, so the vertex is named
//! here by its first corner.
use super::Corner;
use rayon::prelude::*;

/// Per corner of `corners`, the first corner of its vertex (the module's rule).
pub(super) fn welded(corners: &[Corner]) -> Vec<u32> {
    // The bits of every value, zero of either sign as one; none when a value is not a number.
    let key = |c: &Corner| {
        let [x, y, z] = c.position;
        let [nx, ny, nz] = c.normal;
        let [u, v] = c.uv;
        let values = [x, y, z, nx, ny, nz, u, v];
        let bits = |value: f32| if value == 0.0 { 0 } else { value.to_bits() };
        (!values.iter().any(|value| value.is_nan())).then(|| values.map(bits))
    };
    let mut keyed: Vec<([u32; 8], u32)> = (corners.par_iter().enumerate())
        .filter_map(|(at, c)| key(c).map(|k| (k, at as u32)))
        .collect();
    keyed.par_sort_unstable();
    let mut welded: Vec<u32> = (0..corners.len() as u32).collect();
    for vertex in keyed.chunk_by(|a, b| a.0 == b.0) {
        let first = vertex[0].1;
        vertex
            .iter()
            .for_each(|&(_, at)| welded[at as usize] = first);
    }
    welded
}
