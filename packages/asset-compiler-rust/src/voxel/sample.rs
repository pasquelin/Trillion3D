//! One voxel sampled: 64 rays across it against the level-0 triangles that overlap it, each a
//! direction uniform on the sphere along a line through the cube, every line through it as likely
//! as any other (`ray_sets`), through the alpha-aware hit filter — a cut texel lets the ray
//! through, so a leaf card's cut-out thins the voxel as it thins the pixel. A ray is counted on
//! the face its direction leans on most: the side its surface is seen from.
//!
//! What a voxel keeps are each face's sums (`Moments`), so the coverage a dropped neighbour hands
//! over carries its share of them (`solid.rs`), and a solid voxel shows what its faces open on
//! empty space see: base colour and ORM weighed by the face's coverage, and over every hit its
//! normal, turned to the face — the side the surface is seen from — and the normals' products — the
//! distribution whose projected area weighs a neighbour.
use super::raster::Cell;
use crate::trace::surface::Traceable;
use crate::trace::tracer::Among;
use std::f64::consts::TAU;
use std::sync::OnceLock;
use trillion3d_math::sequence::random::splitmix_draw;
use trillion3d_math::vector::vec3::{cross, dominant_axis, frame_across};
use trillion3d_math::vector::vecn::{add, scale, weighted_sum};

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
    pub covered: f64,
    /// Over the hits, a hit `1 / rays` of its face: normals, their products `xx yy zz xy xz yz`,
    /// and the weight of the hits.
    pub normal: [f64; 3],
    pub ndf: [f64; 6],
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
            covered: self.covered * a + other.covered * b,
            normal: mix(self.normal, a, other.normal, b),
            ndf: mix(self.ndf, a, other.ndf, b),
            hits: self.hits * a + other.hits * b,
        }
    }

    /// The hit's normal, at `weight`.
    fn hit(&mut self, normal: [f64; 3], weight: f64) {
        let [x, y, z] = normal;
        let products = [x * x, y * y, z * z, x * y, x * z, y * z].map(|p| p * weight);
        self.normal = add(self.normal, scale(normal, weight));
        self.ndf = std::array::from_fn(|k| self.ndf[k] + products[k]);
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

/// Rays a voxel casts, as the reference's builder casts by default: enough that a voxel's coverage
/// steps by under 2 %, few enough that a forest's cells sample in minutes.
const RAYS: usize = 64;

/// Sets of rays the voxels take in turn, by their cell: neighbours sample with other rays, so a
/// pattern of the set never repeats across a wall.
const VARIATIONS: usize = 16;

/// One ray of a set, in voxel sides from the voxel's centre: its direction, where it enters the
/// cube, how far it runs inside, the face it is counted on — its direction's main axis, face `2a`
/// for a ray along `+a` —, the weight of its hit — one over the rays its set counts on that face —
/// and the footprint its texture is filtered over, an eighth of a side each way: all of it once a
/// set, never once a voxel.
struct Ray {
    direction: [f64; 3],
    enter: [f64; 3],
    length: f64,
    face: usize,
    weight: f64,
    footprint: [[f64; 3]; 2],
}

/// The sets of rays: each a direction uniform on the sphere and a line through a disk across it,
/// as wide as the cube's diagonal, kept when it crosses the cube — every line through the cube as
/// likely as any other —, from a fixed seed so a rebuild samples the same bytes.
fn ray_sets() -> &'static [Vec<Ray>; VARIATIONS] {
    static SETS: OnceLock<[Vec<Ray>; VARIATIONS]> = OnceLock::new();
    SETS.get_or_init(|| {
        std::array::from_fn(|set| {
            let mut state = 0x7672_6179_u64 ^ (set as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
            let mut rays = Vec::with_capacity(RAYS);
            while rays.len() < RAYS {
                let mut draw = || splitmix_draw(&mut state);
                let (z, turn) = (1.0 - 2.0 * draw(), TAU * draw());
                let ring = (1.0 - z * z).max(0.0).sqrt();
                let direction = [ring * turn.cos(), ring * turn.sin(), z];
                let (radius, angle) = (draw().sqrt() * 0.5 * 3f64.sqrt(), TAU * draw());
                let across = frame_across(direction);
                let other = cross(direction, across);
                let origin = add(
                    scale(across, radius * angle.cos()),
                    scale(other, radius * angle.sin()),
                );
                let (mut entry, mut exit) = (f64::NEG_INFINITY, f64::INFINITY);
                for (k, d) in direction.iter().enumerate() {
                    let (near, far) = match d.abs() < 1e-12 {
                        true if origin[k].abs() > 0.5 => (f64::INFINITY, f64::NEG_INFINITY),
                        true => (f64::NEG_INFINITY, f64::INFINITY),
                        false => {
                            let (a, b) = ((-0.5 - origin[k]) / d, (0.5 - origin[k]) / d);
                            (a.min(b), a.max(b))
                        }
                    };
                    entry = entry.max(near);
                    exit = exit.min(far);
                }
                if entry < exit {
                    let axis = dominant_axis(direction);
                    let edge = scale(frame_across(direction), 1.0 / 8.0);
                    rays.push(Ray {
                        direction,
                        enter: add(origin, scale(direction, entry)),
                        length: exit - entry,
                        face: 2 * axis + usize::from(direction[axis] < 0.0),
                        weight: 0.0,
                        footprint: [edge, cross(direction, edge)],
                    });
                }
            }
            let mut per_face = [0usize; FACES];
            for ray in &rays {
                per_face[ray.face] += 1;
            }
            for ray in &mut rays {
                ray.weight = 1.0 / per_face[ray.face] as f64;
            }
            rays
        })
    })
}

/// The voxel `cell` of side `side`, whose overlapping triangles are `ranks`: its coverage — the
/// share of its rays that hit inside it — and the sums of each face's rays — a hit `1 / rays` of
/// its face, its normal turned to the side the ray comes from. A ray's texture is filtered over its
/// share of the voxel's cross-section, an eighth of the side each way. Nothing is allocated.
pub(super) fn sample(
    probe: &Probe<'_>,
    cell: Cell,
    side: f64,
    ranks: &[u32],
) -> (f64, [Moments; FACES]) {
    let among = Among {
        ranks,
        near: probe.near,
        from: 0.0,
        tie: probe.tie,
    };
    let set = (cell[0] as u32 ^ (cell[1] as u32).wrapping_mul(3) ^ (cell[2] as u32).wrapping_mul(5))
        as usize
        % VARIATIONS;
    let centre = cell.map(|c| (f64::from(c) + 0.5) * side);
    let mut faces = [Moments::default(); FACES];
    let mut hits = 0usize;
    for ray in &ray_sets()[set] {
        let origin = add(centre, scale(ray.enter, side));
        let footprint = ray.footprint.map(|edge| scale(edge, side));
        let limit = ray.length * side;
        let Some(sample) = probe
            .mesh
            .hit(origin, ray.direction, limit, among, footprint)
        else {
            continue;
        };
        hits += 1;
        let face = &mut faces[ray.face];
        face.colour = add(face.colour, scale(sample.colour, ray.weight));
        face.orm = add(face.orm, scale(sample.orm, ray.weight));
        face.covered += ray.weight;
        face.hit(sample.normal, ray.weight);
    }
    (hits as f64 / RAYS as f64, faces)
}
