//! One voxel sampled: rays from each of its six faces across it to the opposite one, against the
//! level-0 triangles that overlap it. A face is cut in `TILES` × `TILES` tiles, each a texel of
//! the surface sampler (`surface_trace::texel`: four rays at its subsamples, sixteen where they part or
//! one misses), its textures filtered over the tile. A voxel is drawn from one pixel wide, so its
//! face averages what a pixel shows: up to 16 × 16 rays, as many as a pixel's reference, where
//! the sampler's sixteen alone would alias detail repeating at about a quarter voxel. A voxel holds
//! its lower faces and not its upper ones, along each axis, whichever way its rays cross it: a
//! surface on a face — a building's foot on the voxels' grid — belongs to the voxel above it alone,
//! not also to an empty one below.
//!
//! What a voxel keeps are each face's sums (`Moments`), so the coverage a dropped neighbour hands
//! over carries its share of them (`solid.rs`), and a solid voxel shows what its faces open on
//! empty space see: base colour and ORM weighed by the face's coverage, and over every hit its
//! normal, turned to the face — the side the surface is seen from —, the normals' products — the
//! distribution whose projected area weighs a neighbour — and its position and their products,
//! whose covariance gives the contour plane.
use super::raster::Cell;
use crate::proxy::tracer::Among;
use crate::surface_trace::{texel, Traceable, SUBSAMPLES};
use std::cell::RefCell;
use trillion3d_math::color::srgb_byte_to_linear;
use trillion3d_math::scalar::byte_to_unit;
use trillion3d_math::vecn::{add, scale, weighted_sum};

/// The surface a voxel is sampled against: the mesh, a zero `near` per triangle (a voxel's rays
/// test every triangle in it), and its tie.
pub(super) struct Probe<'a> {
    pub mesh: &'a Traceable,
    pub near: &'a [f64],
    pub tie: f64,
}

/// Weighted sums of what a voxel sees; each part's mean is its sum over its weight.
#[derive(Clone, Copy, Default)]
pub(super) struct Moments {
    /// Base colour (linear) and ORM, by coverage, and the coverage they weigh.
    pub colour: [f64; 3],
    pub orm: [f64; 3],
    pub material: f64,
    /// Over the hits, a hit `1 / rays` of its face: normals, their products `xx yy zz xy xz yz`,
    /// positions, their products, and the weight of the hits.
    pub normal: [f64; 3],
    pub ndf: [f64; 6],
    pub point: [f64; 3],
    pub spread: [f64; 6],
    pub hits: f64,
}

impl Moments {
    /// `self·a + other·b`.
    pub fn blend(&self, a: f64, other: &Self, b: f64) -> Self {
        fn mix<const N: usize>(x: [f64; N], a: f64, y: [f64; N], b: f64) -> [f64; N] {
            weighted_sum([x, y], [a, b])
        }
        Self {
            colour: mix(self.colour, a, other.colour, b),
            orm: mix(self.orm, a, other.orm, b),
            material: self.material * a + other.material * b,
            normal: mix(self.normal, a, other.normal, b),
            ndf: mix(self.ndf, a, other.ndf, b),
            point: mix(self.point, a, other.point, b),
            spread: mix(self.spread, a, other.spread, b),
            hits: self.hits * a + other.hits * b,
        }
    }

    /// The hit's normal and position, at `weight`.
    fn hit(&mut self, normal: [f64; 3], at: [f64; 3], weight: f64) {
        let products = |v: [f64; 3]| {
            let [x, y, z] = v;
            [x * x, y * y, z * z, x * y, x * z, y * z].map(|p| p * weight)
        };
        self.normal = add(self.normal, scale(normal, weight));
        self.ndf = std::array::from_fn(|k| self.ndf[k] + products(normal)[k]);
        self.point = add(self.point, scale(at, weight));
        self.spread = std::array::from_fn(|k| self.spread[k] + products(at)[k]);
        self.hits += weight;
    }
}

/// A 3 × 3 symmetric matrix from its sums `xx yy zz xy xz yz` over `weight`.
pub(super) fn symmetric(sums: [f64; 6], weight: f64) -> [[f64; 3]; 3] {
    let [xx, yy, zz, xy, xz, yz] = sums.map(|s| s / weight);
    [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]]
}

/// A voxel's six faces, by the direction its rays cross the voxel in: `+x −x +y −y +z −z`.
pub(super) const FACES: usize = 6;

/// Tiles a face's side is cut in, each one texel of the sampler: with its sixteen rays at most,
/// a face casts up to `16 × 16`, a pixel's reference rays when the voxel covers one pixel.
const TILES: usize = 4;

/// The voxel `cell` of side `side`, whose overlapping triangles are `ranks`: its coverage — the
/// largest of its faces', the share of a face's tiles' rays that hit inside it —, the sums of
/// each face's rays, their normals turned to the face the rays come from, and the surface most of
/// its hits land on, by its rank in the mesh's surfaces.
pub(super) fn sample(
    probe: &Probe<'_>,
    cell: Cell,
    side: f64,
    ranks: &[u32],
) -> (f64, [Moments; FACES], Option<u32>) {
    let among = Among {
        ranks,
        near: probe.near,
        from: 0.0,
        tie: probe.tie,
    };
    // Rays start back from their face past the tracer's nearest distance and stop as far short of
    // the opposite one: along an axis, a hit on the lower face counts and one on the upper does not.
    let back = 2e-4_f64.max(side * 1e-6);
    let tile = side / TILES as f64;
    let corner = cell.map(|c| f64::from(c) * side);
    let mut coverage = 0.0_f64;
    let mut surfaces: Vec<(u32, f64)> = Vec::new();
    let faces = std::array::from_fn(|face| {
        let (a, sign) = (face / 2, if face % 2 == 0 { 1.0 } else { -1.0 });
        let (u, v) = ((a + 1) % 3, (a + 2) % 3);
        let unit = |k: usize| std::array::from_fn(|i| if i == k { 1.0 } else { 0.0 });
        let (ray, footprint) = (
            scale(unit(a), sign),
            [scale(unit(u), tile), scale(unit(v), tile)],
        );
        let start = corner[a] - back + if sign > 0.0 { 0.0 } else { side };
        let mut moments = Moments::default();
        let mut covered = 0.0;
        for (i, j) in (0..TILES).flat_map(|i| (0..TILES).map(move |j| (i, j))) {
            let hits = RefCell::new(Vec::new());
            let rays = std::cell::Cell::new(0usize);
            let trace = |k: usize| {
                let [su, sv] = SUBSAMPLES[k];
                let mut origin = corner;
                origin[u] += (i as f64 + su) * tile;
                origin[v] += (j as f64 + sv) * tile;
                origin[a] = start;
                rays.set(rays.get() + 1);
                let (sample, _, triangle) = probe.mesh.hit(origin, ray, side, among, footprint)?;
                let at = add(origin, scale(ray, sample.distance));
                let surface = probe.mesh.world.tags[triangle];
                hits.borrow_mut().push((sample.normal, at, surface));
                Some(sample)
            };
            let [[r, g, b, hit], _, [o, rough, metal, _]] =
                texel(side, trace, |depth| depth.is_infinite());
            let share = byte_to_unit(hit) / (TILES * TILES) as f64;
            covered += share;
            moments.colour = add(
                moments.colour,
                [r, g, b].map(|c| srgb_byte_to_linear(c) * share),
            );
            moments.orm = add(
                moments.orm,
                [o, rough, metal].map(|c| byte_to_unit(c) * share),
            );
            moments.material += share;
            let weight = 1.0 / (rays.get().max(1) * TILES * TILES) as f64;
            for (normal, at, surface) in hits.into_inner() {
                moments.hit(normal, at, weight);
                match surfaces.iter_mut().find(|s| s.0 == surface) {
                    Some(votes) => votes.1 += weight,
                    None => surfaces.push((surface, weight)),
                }
            }
        }
        coverage = coverage.max(covered);
        moments
    });
    let most = surfaces.into_iter().max_by(|a, b| a.1.total_cmp(&b.1));
    (coverage, faces, most.map(|s| s.0))
}
