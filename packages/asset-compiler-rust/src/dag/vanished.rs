//! The parts a reduction removes whole: what removing them costs.
//!
//! A reduction's error measures how far what it keeps moves from the surface it replaces; it says
//! nothing of a disconnected part it removes whole. Removing one is a simplification like any
//! other, and costs at least the part's own extent, the diameter of its bounds in the source mesh:
//! a part drops only at the level whose error covers it, and since a group's error is never below
//! its children's, a column or an arch stays until the error is as wide as it is (#484). The
//! simplifier's error alone let a part go at a level that publishes less: on
//! `signature-architecture`, a limestone reduction dropped walls up to 32 m across at 21.8 m of
//! error. The source extent, not the remnant's: levels below may have shrunk a part before one
//! removes what is left of it, and an arcade 12.9 m long left at 4.9 m of error that way.
//!
//! It also costs the distance from its surface to the nearest surface the reduction keeps. A roof
//! of shingles 0.4 m across, each removed at 0.4 m of error, loses half its shingles on one level
//! and half the rest on the next, all at the same 0.4 m: its coarsest level kept 1.8 % of its area
//! on the open world's chalet (#484). Measured to the surface kept, a roof of parts keeps a cover
//! within its error.
use super::bounds::bounding_sphere;
use crate::join::Join;
use crate::physics_cook::hausdorff::one_sided_distance;
use std::collections::{BTreeMap, HashMap};

/// The corners of `source` as local ids of their welded position (`weld`), those ids joined over
/// its triangles: one root per part.
fn joined(source: &[u32], weld: &[u32]) -> (HashMap<u32, u32>, Vec<u32>, Join) {
    let mut local: HashMap<u32, u32> = HashMap::new();
    let mut id = |v: u32| {
        let next = local.len() as u32;
        *local.entry(weld[v as usize]).or_insert(next)
    };
    let corners: Vec<u32> = source.iter().map(|&v| id(v)).collect();
    let mut join = Join::new(local.len());
    for tri in corners.as_chunks::<3>().0 {
        join.unite(tri[0], tri[1]);
        join.unite(tri[0], tri[2]);
    }
    (local, corners, join)
}

/// The parts of `source`, connected over shared positions (`weld`): one corner list each.
pub(crate) fn parts(source: &[u32], weld: &[u32]) -> Vec<Vec<u32>> {
    let (_, corners, mut join) = joined(source, weld);
    let mut parts: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
    let triangles = source.as_chunks::<3>().0.iter();
    for (tri, local) in triangles.zip(corners.as_chunks::<3>().0) {
        parts.entry(join.root(local[0])).or_default().extend(tri);
    }
    parts.into_values().collect()
}

/// Per source vertex, the diameter of the bounds of its part in the source mesh `indices`: what
/// removing whatever the levels below left of that part costs, however far they reduced it.
pub(super) fn part_extents(positions: &[f32], indices: &[u32], weld: &[u32]) -> Vec<f64> {
    let mut extents = vec![0.0; positions.len() / 3];
    for part in parts(indices, weld) {
        let extent = extent(positions, &part);
        part.iter().for_each(|&v| extents[v as usize] = extent);
    }
    extents
}

/// The extent of a part, the diameter of the bounds of its corners.
pub(crate) fn extent(positions: &[f32], part: &[u32]) -> f64 {
    2.0 * bounding_sphere(positions, part)[3]
}

/// What removing the parts of `source` of which `kept` holds no vertex costs: the largest of their
/// source extents (`part_extents`) and of their distances to the triangles of `kept`, both over
/// the source vertices; parts meet at a shared position (`weld`).
pub(super) fn vanished_error(
    source: &[u32],
    kept: &[u32],
    positions: &[f32],
    weld: &[u32],
    extents: &[f64],
) -> f64 {
    let (local, corners, mut join) = joined(source, weld);
    let mut alive = vec![false; local.len()];
    for v in kept {
        if let Some(&l) = local.get(&weld[*v as usize]) {
            alive[join.root(l) as usize] = true;
        }
    }
    let (mut extent, mut removed) = (0.0_f64, Vec::new());
    let triangles = source.as_chunks::<3>().0.iter();
    for (tri, local) in triangles.zip(corners.as_chunks::<3>().0) {
        if !alive[join.root(local[0]) as usize] {
            // A part of `source` lies within one source part: its corners share one extent.
            extent = extent.max(extents[tri[0] as usize]);
            removed.extend(tri);
        }
    }
    extent.max(one_sided_distance(positions, &removed, kept))
}
