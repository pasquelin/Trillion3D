//! Unique texture coordinates for a mesh whose material is baked, by growing patches into
//! islands that each flatten with little stretch:
//!
//! 1. small patches (`initial_patches`): seeds spread by area, each component's furthest point
//!    from the seeds so far added in turn (farthest-point sampling), then every triangle given to
//!    the seed nearest by a distance weighed by the turn of its normal from the seed's, so patches
//!    follow the surface's creases;
//! 2. islands (`islands`): neighbouring patches merged while the exponential map of the pair keeps
//!    its mean squared area distortion under the threshold, the normal deviation allowed growing in
//!    four steps so flat regions join first;
//! 3. each island's discrete exponential map (Schmidt et al. 2006, `expmap`: upwind average from
//!    the vertex furthest from its boundary), turned to its least bounding box (`orientation`),
//!    then packed (`pack.rs`).
//! The patches live in `patches`, the exponential map in `expmap`, the islands in `islands`.
use rayon::prelude::*;
use std::cmp::Ordering;
mod patches;
use patches::{dual, initial_patches};
mod expmap;
use expmap::expmap;
mod islands;
use islands::{islands, orientation};

/// The unwrap's settings: initial patch count, merging threshold (mean squared area distortion an
/// island may reach), normal deviation (degrees two merged patches may differ by), least patch
/// size in triangles.
const INITIAL_PATCHES: usize = 250;
const MERGING_THRESHOLD: f64 = 1.5;
const MAX_NORMAL_DEVIATION: f64 = 45.0;
const MIN_PATCH_SIZE: usize = 2;
/// The clamp of a triangle's area distortion, so one degenerate triangle cannot swamp the mean.
const CLAMP_DISTORTION: f64 = 100.0;

/// A mesh's topology for the unwrap: welded positions and triangles.
pub(super) struct Topology<'a> {
    pub points: &'a [[f64; 3]],
    pub triangles: &'a [[usize; 3]],
}

/// A min-heap entry of a Dijkstra: distance, node.
#[derive(PartialEq)]
struct Entry(f64, usize);
impl Eq for Entry {}
impl PartialOrd for Entry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Entry {
    fn cmp(&self, other: &Self) -> Ordering {
        other.0.total_cmp(&self.0).then(other.1.cmp(&self.1))
    }
}

/// Per corner of `topology`'s triangles, its island's coordinates in metres, turned to its least
/// box, and the islands as triangle lists.
pub(super) fn unwrap(topology: &Topology) -> (Vec<[f64; 2]>, Vec<Vec<usize>>) {
    let links = dual(topology);
    let patches = initial_patches(topology, &links);
    let islands = islands(topology, &links, patches);
    let mut corners = vec![[0.0f64; 2]; topology.triangles.len() * 3];
    let mapped: Vec<(Vec<usize>, Vec<[f64; 2]>)> = islands
        .par_iter()
        .map(|island| {
            let (vertices, uv) = expmap(topology, island);
            let reached: Vec<[f64; 2]> = uv.iter().flatten().copied().collect();
            let mut uv: Vec<[f64; 2]> = uv.into_iter().map(|p| p.unwrap_or([0.0; 2])).collect();
            if let Some(angle) = orientation(&reached) {
                let (sin, cos) = (-angle).sin_cos();
                for p in uv.iter_mut() {
                    *p = [cos * p[0] - sin * p[1], sin * p[0] + cos * p[1]];
                }
            }
            (vertices, uv)
        })
        .collect();
    for (island, (vertices, uv)) in islands.iter().zip(&mapped) {
        for &t in island {
            for k in 0..3 {
                let v = topology.triangles[t][k];
                corners[t * 3 + k] = vertices.binary_search(&v).map_or([0.0; 2], |at| uv[at]);
            }
        }
    }
    (corners, islands)
}
