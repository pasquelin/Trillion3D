//! A mesh's cards: the voxel volume over its bounds, as fine as the surfels it gives allow, the
//! surfels of the six directions, the clusters that cover them and the cards of the clusters.
use super::abi::MESH_CARDS_DIRECTIONS;
use super::cards::{card, local_bounds, Card};
use super::clusters::{limit, of_direction, Cluster, Params};
use super::surfels::{along, Cast, Overflow, Surfel};
use super::volume::Volume;
use super::CardSettings;
use crate::distance_field::{hemisphere, Scene};
use crate::plugins::scene::cancel::going;
use rayon::prelude::*;
use std::sync::atomic::AtomicBool;

type Vec3 = [f64; 3];

/// The most voxels along a side of the first volume tried.
const MOST_VOXELS: u32 = 64;
/// The surfels past which the volume is tried again with a side of half the voxels, so that a
/// dense two-sided mesh does not take unbounded time.
const MOST_SURFELS: usize = 10_000;
/// The rays a surfel casts over its hemisphere: the largest square of them is cast.
const HEMISPHERE_RAYS: usize = 32;
/// The weighted coverage, in cells, a cluster needs to be worth a card.
const MIN_CLUSTER_COVERAGE: f32 = 15.0;
/// How far, centimetres, the mesh's bounds grow on each side before the volume is fitted over them.
const BOUNDS_MARGIN: f64 = 1.0;
/// The least half-extent, centimetres, of the bounds the volume is fitted over.
const LEAST_HALF_EXTENT: f64 = 1.0;

/// A mesh's cards.
#[derive(Clone)]
pub(super) struct MeshCards {
    /// The box the cards were fitted in, the mesh's grown by a margin, centimetres.
    pub low: Vec3,
    pub high: Vec3,
    /// Whether a quarter of the mesh's triangles or more are two-sided, or the build asked for all.
    pub mostly_two_sided: bool,
    pub cards: Vec<Card>,
}

/// The box a volume is fitted over for a mesh of bounds `low, high`: each half-extent grown by a
/// margin and at least a least half-extent, so that a flat mesh has one.
fn grown((low, high): (Vec3, Vec3)) -> (Vec3, Vec3) {
    let centre = [0, 1, 2].map(|k| 0.5 * (low[k] + high[k]));
    let half = [0, 1, 2].map(|k| (0.5 * (high[k] - low[k]) + BOUNDS_MARGIN).max(LEAST_HALF_EXTENT));
    (
        [0, 1, 2].map(|k| centre[k] - half[k]),
        [0, 1, 2].map(|k| centre[k] + half[k]),
    )
}

/// The volume over `bounds` and the surfels of its six directions: the first volume is
/// `MOST_VOXELS` voxels a side at most, the next half of them, and so on while the surfels are
/// more than `MOST_SURFELS` and the side holds more than one voxel. A try that is to be dropped
/// stops as soon as its surfels pass `MOST_SURFELS` (`Overflow`); the last try, whatever it finds,
/// is kept and runs whole. None once `cancelled` is raised: the token is read before each
/// direction's rays are cast.
fn surfel_scene(
    scene: &Scene,
    (rays, normal_threshold): (&[Vec3], f32),
    bounds: (Vec3, Vec3),
    cancelled: &AtomicBool,
) -> Option<(Volume, Vec<Vec<Surfel>>)> {
    let mut most = MOST_VOXELS;
    loop {
        let volume = Volume::of(bounds, most);
        let cast = Cast {
            scene,
            volume: &volume,
            rays,
            normal_threshold,
        };
        most /= 2;
        let last = most <= 1;
        let overflow = Overflow::new(if last { usize::MAX } else { MOST_SURFELS });
        let surfels: Vec<Vec<Surfel>> = (0..MESH_CARDS_DIRECTIONS)
            .into_par_iter()
            .map(|direction| going(cancelled).map(|()| along(&cast, direction, &overflow)))
            .collect::<Option<_>>()?;
        if !overflow.passed() {
            return Some((volume, surfels));
        }
    }
}

/// The cards of the mesh `scene` holds, whose bounds are `bounds` (the distance field's where it has
/// one), as `settings` say; None once `cancelled` is raised, which the driver that asked refuses as
/// a cancelled compilation (`plugins::scene::cancel::check`).
pub(super) fn build(
    scene: &Scene,
    bounds: (Vec3, Vec3),
    settings: &CardSettings,
    cancelled: &AtomicBool,
) -> Option<MeshCards> {
    let bounds = grown(bounds);
    let rays = hemisphere(HEMISPHERE_RAYS);
    let normal_threshold = settings.normal_threshold as f32;
    let (volume, surfels) = surfel_scene(scene, (&rays, normal_threshold), bounds, cancelled)?;
    let params = Params {
        min_cluster: MIN_CLUSTER_COVERAGE,
        min_outer: MIN_CLUSTER_COVERAGE.min(0.5 * volume.average_face_area),
        min_density: settings.min_density as f32 / 3.0,
    };
    let mostly_two_sided = scene.mostly_two_sided;
    let mut clusters: Vec<Vec<Cluster>> = (0..MESH_CARDS_DIRECTIONS)
        .into_par_iter()
        .map(|direction| {
            let depth = volume.bases[direction].size[2];
            of_direction(&surfels[direction], (depth, mostly_two_sided), &params)
        })
        .collect();
    limit(&mut clusters, settings.max_cards as usize);
    let mut cards = Vec::new();
    for (direction, kept) in clusters.iter().enumerate() {
        let basis = &volume.bases[direction];
        let local = local_bounds(basis, bounds);
        cards.extend(
            kept.iter()
                .map(|c| card((basis, direction), volume.voxel, c, local)),
        );
    }
    Some(MeshCards {
        low: bounds.0,
        high: bounds.1,
        mostly_two_sided,
        cards,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `layers` horizontal plates of a `side` metre square, a `cells` by `cells` grid of quads each,
    /// stacked 0.2 m apart: a dense two-sided scene whose first volumes hold far more surfels than
    /// `MOST_SURFELS`.
    fn plates(layers: usize, side: f32, cells: usize) -> Scene {
        let step = side / cells as f32;
        let mut soup = Vec::new();
        for layer in 0..layers {
            let z = layer as f32 * 0.2;
            for i in 0..cells {
                for j in 0..cells {
                    let (x, y) = (i as f32 * step, j as f32 * step);
                    let corner = |dx: f32, dy: f32| [x + dx * step, y + dy * step, z];
                    for t in [
                        [(0., 0.), (1., 0.), (0., 1.)],
                        [(1., 0.), (1., 1.), (0., 1.)],
                    ] {
                        soup.extend(t.iter().flat_map(|&(dx, dy)| corner(dx, dy)));
                    }
                }
            }
        }
        let count = soup.len() / 9;
        let kept: Vec<usize> = (0..count).collect();
        Scene::of_triangles(&soup, vec![true; count], &kept, true).expect("triangles")
    }

    /// What a try of the volume gives with no early stop: the way the tries were taken before one
    /// that was to be dropped stopped at once.
    fn whole_tries(
        scene: &Scene,
        (rays, normal_threshold): (&[Vec3], f32),
        bounds: (Vec3, Vec3),
    ) -> (Volume, Vec<Vec<Surfel>>) {
        let mut most = MOST_VOXELS;
        loop {
            let volume = Volume::of(bounds, most);
            let cast = Cast {
                scene,
                volume: &volume,
                rays,
                normal_threshold,
            };
            let never = Overflow::new(usize::MAX);
            let surfels: Vec<Vec<Surfel>> = (0..MESH_CARDS_DIRECTIONS)
                .map(|direction| along(&cast, direction, &never))
                .collect();
            let total: usize = surfels.iter().map(Vec::len).sum();
            most /= 2;
            if total <= MOST_SURFELS || most <= 1 {
                return (volume, surfels);
            }
        }
    }

    fn keys(surfels: &[Vec<Surfel>]) -> Vec<Vec<([i32; 3], i32, u32, u32)>> {
        let key = |s: &Surfel| {
            (
                s.coord,
                s.min_ray_z,
                s.coverage.to_bits(),
                s.weighted.to_bits(),
            )
        };
        surfels
            .iter()
            .map(|d| d.iter().map(key).collect())
            .collect()
    }

    // Behaviour: stopping a try that is to be dropped changes nothing of the one kept — the same
    // volume and the same surfels, bit for bit, as when every try runs whole — on a scene whose
    // first tries hold more than `MOST_SURFELS` and on one whose first holds fewer.
    #[test]
    fn stopping_a_dropped_try_early_keeps_the_same_surfels() {
        let rays = hemisphere(HEMISPHERE_RAYS);
        let never_cancelled = AtomicBool::new(false);
        for (layers, side, cells) in [(8, 6.4, 16), (3, 1.0, 4), (1, 6.4, 8)] {
            let scene = plates(layers, side, cells);
            let bounds = grown((scene.low, scene.high));
            let input = (rays.as_slice(), 0.25f32);
            let (volume, surfels) =
                surfel_scene(&scene, input, bounds, &never_cancelled).expect("not cancelled");
            let (whole_volume, whole) = whole_tries(&scene, input, bounds);
            assert_eq!(volume.voxel.to_bits(), whole_volume.voxel.to_bits());
            assert_eq!(keys(&surfels), keys(&whole));
        }
    }
}
