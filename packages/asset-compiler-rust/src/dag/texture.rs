//! The texture deviation a group reduction certifies (#977).
//!
//! A coarse triangle draws each texel where its interpolated texture coordinate falls, while the
//! source drew that texel on the surface point carrying the same coordinate. Their distance, in
//! object units, is how far the pattern slides, and the published error never goes below it.
//!
//! The source point is looked up only among the triangles the collapse replaced: the group's live
//! triangles of the coarse triangle's own texture island (the connected surface once the seams are
//! cut). A collapse never carries a corner across a protected seam, so the coarse triangle lies on
//! its island, and on repeated coordinates — a tiled facade, every brick mapping the same square —
//! the lookup can never answer with another brick metres away. Each coarse triangle is sampled at
//! its corners, its edge midpoints and its centroid, as the geometric distance is (`measured.rs`).
use super::measured::Surface;
use crate::shared_math::WordMap;
use lookup::Lookup;
use rayon::prelude::*;

mod lookup;

/// The island of every texture copy (`weld_seam` key) the live triangles use: copies joined by a
/// live triangle are one island (`vanished::joined`, keyed by texture copy instead of position).
pub(super) fn copy_islands(weld_seam: &[u32], live: &[u32]) -> WordMap<u32, u32> {
    let (local, _, mut join) = super::vanished::joined(live, weld_seam);
    local
        .into_iter()
        .map(|(copy, slot)| (copy, join.root(slot)))
        .collect()
}

/// `floor.max(d)`, bit for bit, for `d` the largest texture deviation of `kept` from `live` over
/// every texture set (zero without one): a sample stops at the first source point within `floor`.
pub(super) fn texture_deviation_above(
    surface: &Surface,
    live: &[u32],
    kept: &[u32],
    floor: f64,
) -> f64 {
    let sets = &surface.uv_sets;
    let zero = floor.max(0.0);
    if sets.is_empty() || live.is_empty() || kept.is_empty() {
        return zero;
    }
    let islands = copy_islands(surface.weld_seam, live);
    let island = |v: u32| islands.get(&surface.weld_seam[v as usize]).copied();
    let deviation = |uvs: &[f32]| {
        let lookup = Lookup::new(surface.positions, uvs, live, &island);
        kept.par_chunks_exact(3)
            .map(|tri| lookup.triangle(tri, &island, floor))
            .reduce(|| 0.0, f64::max)
    };
    sets.iter().map(|uvs| deviation(uvs)).fold(zero, f64::max)
}
