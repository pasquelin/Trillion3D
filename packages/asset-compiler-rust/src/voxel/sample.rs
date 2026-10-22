//! One voxel sampled: its rays across it — 64 by default, the mesh's build names their count and
//! how they run (`VoxelSampling`) — against the level-0 triangles that overlap it, each a
//! direction uniform on the sphere along a line through the cube, every line through it as likely
//! as any other (`rays.rs`), through the alpha-aware hit filter — a cut texel lets the ray
//! through, so a leaf card's cut-out thins the voxel as it thins the pixel. A ray is counted on
//! the face its direction leans on most: the side its surface is seen from.
//!
//! What a voxel keeps are each face's sums (`Moments`), so the coverage a dropped neighbour hands
//! over carries its share of them (`solid.rs`), and a solid voxel shows what its faces open on
//! empty space see: base colour and ORM weighed by the face's coverage, and over every hit its
//! normal, turned to the face — the side the surface is seen from — and the normals' products — the
//! distribution whose projected area weighs a neighbour.
use super::raster::Cell;
use super::rays::{lone_ray, Ray, RaySet, Sampler};
use super::VoxelSampling;
use crate::trace::surface::mesh::Sample;
use crate::trace::surface::Traceable;
use crate::trace::tracer::Among;
use trillion3d_math::vector::vecn::{add, scale, weighted_sum};

/// The surface a voxel is sampled against: the mesh, a zero `near` per triangle (a voxel's rays
/// test every triangle in it), its tie, how it is sampled and the rays it casts.
pub(super) struct Probe<'a> {
    pub mesh: &'a Traceable,
    pub near: &'a [f64],
    pub tie: f64,
    pub sampling: VoxelSampling,
    pub sampler: &'a Sampler,
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

    /// `self · k`.
    fn scaled(&self, k: f64) -> Self {
        Self {
            colour: scale(self.colour, k),
            orm: scale(self.orm, k),
            covered: self.covered * k,
            normal: scale(self.normal, k),
            ndf: self.ndf.map(|sum| sum * k),
            hits: self.hits * k,
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

/// What one ray found of the voxel: nothing, a hit, or a hit outside the stretch that counts, so
/// the ray is left out of the voxel's count.
pub(super) enum Cast {
    Miss,
    Hit(Sample),
    Left,
}

/// A voxel's rays: the mesh they cross, the triangles that overlap the voxel, its centre and side.
pub(super) struct Caster<'a> {
    pub(super) probe: &'a Probe<'a>,
    pub(super) among: Among<'a>,
    pub(super) centre: [f64; 3],
    pub(super) side: f64,
}

impl Caster<'_> {
    /// `ray` cast, a hit within `window` — its distance from the ray's start in voxel sides, both
    /// ends included — kept, one outside it left out.
    pub(super) fn cast(&self, ray: &Ray, window: (f64, f64)) -> Cast {
        let side = self.side;
        let origin = add(self.centre, scale(ray.enter, side));
        let footprint = ray.footprint.map(|edge| scale(edge, side));
        let limit = ray.length * side;
        let found = (self.probe.mesh).hit(origin, ray.direction, limit, self.among, footprint);
        match found {
            None => Cast::Miss,
            Some(hit) if hit.distance < window.0 * side || hit.distance > window.1 * side => {
                Cast::Left
            }
            Some(hit) => Cast::Hit(hit),
        }
    }
}

/// What a voxel's rays found: each face's sums, and how many rays hit and were left out, in all
/// and per face.
#[derive(Default)]
struct Tally {
    faces: [Moments; FACES],
    hits: usize,
    hit_on: [usize; FACES],
    left_on: [usize; FACES],
}

impl Tally {
    fn add(&mut self, ray: &Ray, found: Cast) {
        match found {
            Cast::Miss => {}
            Cast::Left => self.left_on[ray.face] += 1,
            Cast::Hit(sample) => {
                self.hits += 1;
                self.hit_on[ray.face] += 1;
                let face = &mut self.faces[ray.face];
                face.colour = add(face.colour, scale(sample.colour, ray.weight));
                face.orm = add(face.orm, scale(sample.orm, ray.weight));
                face.covered += ray.weight;
                face.hit(sample.normal, ray.weight);
            }
        }
    }

    /// Whether, along some axis, every ray of `set` not left out hit and some are not left out.
    fn hit_along_an_axis(&self, set: &RaySet) -> bool {
        (0..3).any(|a| {
            let rays = set.per_face[2 * a] + set.per_face[2 * a + 1];
            let (left, hit) = (
                self.left_on[2 * a] + self.left_on[2 * a + 1],
                self.hit_on[2 * a] + self.hit_on[2 * a + 1],
            );
            rays > left && rays - left == hit
        })
    }

    /// The faces, each's hits weighing one over the rays `set` counts on it bar those left out.
    fn weighed(mut self, set: &RaySet) -> [Moments; FACES] {
        for (f, face) in self.faces.iter_mut().enumerate() {
            let kept = set.per_face[f] - self.left_on[f];
            if self.left_on[f] > 0 && kept > 0 {
                *face = face.scaled(set.per_face[f] as f64 / kept as f64);
            }
        }
        self.faces
    }
}

/// The part of a ray's run where a hit counts when none is left out: all of it.
const OPEN: (f64, f64) = (f64::NEG_INFINITY, f64::INFINITY);

/// The voxel `cell` of side `side`, whose overlapping triangles are `ranks`: its coverage — the
/// share of its rays that hit inside it — and the sums of each face's rays — a hit `1 / rays` of
/// its face, its normal turned to the side the ray comes from. A ray's texture is filtered over its
/// share of the voxel's cross-section, an eighth of the side each way. A ray the build leaves out
/// of the count (`VoxelSampling::window`) is no hit and no miss: the voxel's rays are the rest.
/// Nothing is allocated.
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
    let centre = cell.map(|c| (f64::from(c) + 0.5) * side);
    let caster = Caster {
        probe,
        among,
        centre,
        side,
    };
    match probe.sampling.single() {
        true => alone(&caster, cell),
        false => among_rays(&caster, cell),
    }
}

/// A voxel casting one ray: covered whole or not at all, by its cell's ray, or — a separable
/// voxel's — by the first ray of the crosshair that hits.
fn alone(caster: &Caster<'_>, cell: Cell) -> (f64, [Moments; FACES]) {
    let mut tally = Tally::default();
    if caster.probe.sampling.separable {
        for ray in &caster.probe.sampler.crosshair {
            let found = caster.cast(ray, OPEN);
            if matches!(found, Cast::Hit(_)) {
                tally.add(ray, found);
                break;
            }
        }
    } else {
        let ray = lone_ray(cell);
        tally.add(&ray, caster.cast(&ray, OPEN));
    }
    (tally.hits as f64, tally.faces)
}

/// A voxel casting a set of rays: its coverage is the share of the rays counted that hit. A
/// separable voxel — one whose rays along some axis all hit — is covered whole where a ray of the
/// crosshair through its centre hits too.
fn among_rays(caster: &Caster<'_>, cell: Cell) -> (f64, [Moments; FACES]) {
    let Probe {
        sampling, sampler, ..
    } = caster.probe;
    let (set, window) = (sampler.set(cell), sampling.window());
    let mut tally = Tally::default();
    for ray in &set.rays {
        tally.add(ray, caster.cast(ray, window));
    }
    let mut counted = set.rays.len() - tally.left_on.iter().sum::<usize>();
    if sampling.separable && tally.hit_along_an_axis(set) {
        let hit = |ray: &Ray| matches!(caster.cast(ray, OPEN), Cast::Hit(_));
        if sampler.crosshair.iter().any(hit) {
            counted = tally.hits;
        }
    }
    let coverage = match counted {
        0 => 0.0,
        counted => tally.hits as f64 / counted as f64,
    };
    (coverage, tally.weighed(set))
}
