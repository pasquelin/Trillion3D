//! The parts a reduction removes whole: how large the largest is, and how far the surface it keeps
//! lies from them.
//!
//! A reduction's error measures how far what it keeps moves from the surface it replaces; it says
//! nothing of a disconnected part it removes whole, which only answers for its own size. A roof of
//! shingles 0.4 m across, each removed at 0.4 m of error, loses half its shingles on one level and
//! half the rest on the next, all at the same 0.4 m: its coarsest level kept 1.8 % of its area on
//! the open world's chalet (#484). A part removed whole therefore costs the distance from its
//! surface to the nearest surface the reduction keeps — a roof of parts keeps a cover within its
//! error.
//!
//! A part larger than the error is not pruned but destroyed. The simplifier's error weighs the
//! normals as well as the positions, so it can grow far past what the kept surface moved: on
//! `signature-architecture`, a limestone reduction at 21.8 m of error moved its surface 1.9 m —
//! a fan of faces turned from the light across every arch opening — and removed paving stones,
//! plinths and walls up to 32 m across; the ivory's columns went the same way, and the root cover
//! stood with two of four columns per arcade (#484). A part may therefore vanish only when it is
//! no larger than the distance the kept surface moved or than the children's error
//! (`Vanished::destroys`); the caller refuses a reduction that destroys one.
use super::bounds::bounding_sphere;
use crate::join::Join;
use crate::physics_cook::hausdorff::one_sided_distance;
use std::collections::{HashMap, HashSet};

/// What a reduction removed whole.
pub(super) struct Vanished {
    /// Largest distance from a part removed to the surface kept.
    pub(super) distance: f64,
    /// A part removed is larger than both the children's error and the distance from the surface
    /// kept to the source.
    pub(super) destroys: bool,
}

/// The parts of `source`, connected over shared positions (`weld`): one corner list each.
pub(crate) fn parts(source: &[u32], weld: &[u32]) -> Vec<Vec<u32>> {
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
    let mut parts: HashMap<u32, Vec<u32>> = HashMap::new();
    let triangles = source.as_chunks::<3>().0.iter();
    for (tri, local) in triangles.zip(corners.as_chunks::<3>().0) {
        parts.entry(join.root(local[0])).or_default().extend(tri);
    }
    parts.into_values().collect()
}

/// The parts of `source` of which `kept` holds no vertex, measured against the triangles of
/// `kept`, both over the source vertices; parts meet at a shared position (`weld`). The distance
/// from `kept` to `source` is measured only when a part removed is larger than `child_error`.
pub(super) fn vanished(
    source: &[u32],
    kept: &[u32],
    positions: &[f32],
    weld: &[u32],
    child_error: f64,
) -> Vanished {
    let alive: HashSet<u32> = kept.iter().map(|&v| weld[v as usize]).collect();
    let (mut radius, mut removed) = (0.0_f64, Vec::new());
    for part in parts(source, weld) {
        if !part.iter().any(|&v| alive.contains(&weld[v as usize])) {
            radius = radius.max(bounding_sphere(positions, &part)[3]);
            removed.extend(part);
        }
    }
    Vanished {
        distance: one_sided_distance(positions, &removed, kept),
        destroys: radius > child_error && radius > one_sided_distance(positions, kept, source),
    }
}
