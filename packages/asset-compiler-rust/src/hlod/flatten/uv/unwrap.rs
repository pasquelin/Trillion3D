//! Unique texture coordinates for a mesh whose material is baked, by growing patches into
//! islands that each flatten with little stretch, at the settings `HlodPatches` holds (the initial
//! patch count, the weight of the normal's turn, the merging threshold, the normal deviation):
//!
//! 0. the mesh made of the topology as a mesh holds one (`Base`): a triangle it cannot hold left
//!    out, one on a side two triangles hold already given copies of that side's points;
//! 1. small patches (`initial_patches`): seeds spread by area, each component's furthest point
//!    from the seeds so far added in turn (farthest-point sampling), then every triangle given to
//!    the seed nearest by a distance weighed by the turn of its normal from the seed's, so patches
//!    follow the surface's creases, the smallest merged into a neighbour and their borders evened;
//! 2. islands (`islands`): neighbouring patches merged while the exponential map of the pair keeps
//!    its mean squared area distortion under the threshold, the normal deviation allowed growing in
//!    four steps so flat regions join first;
//! 3. each island's discrete exponential map (Schmidt et al. 2006, `expmap`: upwind average from
//!    the vertex furthest from its longest boundary loop, in a frame aligned to the world's
//!    horizontal axes), turned about the centre of its box to its least bounding box (`orient`, in
//!    single precision) when the map is whole — the island open, every vertex of it reached;
//! 4. the islands packed into the unit square of `PACKING_RESOLUTION` texels (`pack.rs`), the
//!    coordinates left as the maps made them where the packer finds no layout.
//!
//! Every exponential map — a candidate's measure in step 2, an island's map in step 3 — frames its
//! vertices by their normals weighed by area and interior angle, then smoothed
//! `NORMAL_SMOOTHING_ROUNDS` times by `NORMAL_SMOOTHING_ALPHA` (`normals`); its seed's frame by
//! that seed's normal before smoothing. The smoothing and the packing's resolution are no setting:
//! every unwrap, a merged mesh's or an approximated shell's, takes them.
//! The mesh lives in `base`, over the HLOD code's one triangle mesh (`flatten/mesh.rs`, which also
//! walks an island's boundary loops), the patches in `patches` and `regions`, the islands in
//! `islands` and their measures in `measure`, both ordered by the HLOD code's one unstable sort
//! (`flatten/sort.rs`), the exponential map in `expmap`, the island's triangles as it reads them
//! in `submesh`, its frames in `frame`, its normals in `normals`.
use super::pack::pack;
use super::Topology;
use crate::hlod::options::HlodPatches;
use rayon::prelude::*;
mod base;
use base::Base;
mod expmap;
use expmap::{expmap, Seeding};
mod frame;
mod islands;
use islands::{islands, orient};
mod measure;
mod normals;
mod patches;
use patches::{initial_patches, Faces};
mod regions;
mod submesh;

/// The least patch size, in triangles: a smaller patch joins a neighbour.
const MIN_PATCH_SIZE: usize = 2;
/// The clamp of a triangle's area distortion, so one degenerate triangle cannot swamp the mean.
const CLAMP_DISTORTION: f64 = 100.0;
/// The rounds of smoothing an exponential map's vertex normals take (`normals::smoothed`).
const NORMAL_SMOOTHING_ROUNDS: usize = 5;
/// How far each round of smoothing moves a vertex normal towards its neighbours'.
const NORMAL_SMOOTHING_ALPHA: f64 = 0.25;
/// The side, in texels, of the square the islands are packed into (`pack.rs`).
const PACKING_RESOLUTION: u32 = 512;

/// An unwrap of a topology: per corner of its triangles, its coordinates in the unit square — in
/// metres as its island's map left them where the packer finds no layout, zero on a triangle the
/// mesh does not hold —, the islands as lists of its triangles, and whether the mesh holds each
/// triangle (`Base`).
pub(crate) struct Unwrapped {
    pub(crate) corners: Vec<[f64; 2]>,
    pub(crate) islands: Vec<Vec<usize>>,
    pub(crate) held: Vec<bool>,
}

/// `topology` unwrapped at `settings` (module doc).
pub(crate) fn unwrap(topology: &Topology, settings: &HlodPatches) -> Unwrapped {
    let base = Base::of(topology);
    let faces = Faces::of(&base);
    let patches = initial_patches(&base, &faces, settings);
    let islands = islands(&base, &faces.across, patches, settings);
    let mapped: Vec<(Vec<[usize; 3]>, Vec<[f32; 2]>)> = islands
        .par_iter()
        .map(|island| {
            let map = expmap(&base, island, Seeding::LongestLoop);
            // Kept in single precision, as an island's coordinates are.
            let mut uv: Vec<[f32; 2]> = (map.uv.iter())
                .map(|p| p.unwrap_or([0.0; 2]).map(|x| x as f32))
                .collect();
            // Turned by what its vertices lay out, in the order its triangles first name them.
            if map.whole {
                orient(&mut uv);
            }
            (map.corners, uv)
        })
        .collect();
    let mut corners = vec![[0.0f64; 2]; topology.triangles.len() * 3];
    let mut held = vec![false; topology.triangles.len()];
    for &t in &base.source {
        held[t] = true;
    }
    for (island, (local, uv)) in islands.iter().zip(&mapped) {
        for (&b, tri) in island.iter().zip(local) {
            let t = base.source[b];
            for k in 0..3 {
                corners[t * 3 + k] = uv[tri[k]].map(f64::from);
            }
        }
    }
    let islands: Vec<Vec<usize>> = (islands.into_iter())
        .map(|island| island.into_iter().map(|b| base.source[b]).collect())
        .collect();
    pack(&mut corners, &islands, PACKING_RESOLUTION);
    Unwrapped {
        corners,
        islands,
        held,
    }
}
