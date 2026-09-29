//! The texture deviation a group reduction certifies (#977, Cohen, Olano & Manocha 1998).
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
use super::GroupReductionInput;
use crate::join::Join;
use lookup::Lookup;
use rayon::prelude::*;
use std::collections::HashMap;

mod lookup;

/// The island of every texture copy (`weld_seam` key) the live triangles use: copies joined by a
/// live triangle are one island.
pub(super) fn copy_islands(weld_seam: &[u32], live: &[u32]) -> HashMap<u32, u32> {
    let mut slots: HashMap<u32, u32> = HashMap::new();
    for &vertex in live {
        let next = slots.len() as u32;
        slots.entry(weld_seam[vertex as usize]).or_insert(next);
    }
    let mut join = Join::new(slots.len());
    for tri in live.as_chunks::<3>().0 {
        let a = slots[&weld_seam[tri[0] as usize]];
        for &corner in &tri[1..] {
            join.unite(a, slots[&weld_seam[corner as usize]]);
        }
    }
    slots
        .into_iter()
        .map(|(copy, slot)| (copy, join.root(slot)))
        .collect()
}

/// The largest texture deviation of `kept` from `live` over every texture set; zero without one.
pub(super) fn texture_deviation(input: &GroupReductionInput, live: &[u32], kept: &[u32]) -> f64 {
    let sets = input.attributes.iter().filter(|a| a.width == 2);
    let sets: Vec<&[f32]> = sets.map(|a| a.values).collect();
    if sets.is_empty() || live.is_empty() || kept.is_empty() {
        return 0.0;
    }
    let islands = copy_islands(input.weld_seam, live);
    let island = |v: u32| islands.get(&input.weld_seam[v as usize]).copied();
    let deviation = |uvs: &[f32]| {
        let lookup = Lookup::new(input.positions, uvs, live, &island);
        kept.par_chunks_exact(3)
            .map(|tri| lookup.triangle(tri, &island))
            .reduce(|| 0.0, f64::max)
    };
    sets.into_iter().map(deviation).fold(0.0, f64::max)
}
