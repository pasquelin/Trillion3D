//! The rays a voxel casts, drawn once for a build's voxels (`Sampler`) from a scrambled Sobol'
//! sequence (`sobol_point`), so a rebuild samples the same bytes.
//!
//! By default each a direction uniform on the sphere and a line through a disk across it, as wide
//! as the cube's diagonal, kept when it crosses the cube — every line through the cube as likely
//! as any other —, starting where it enters the cube; `voxelBackUp` starts it that many sides
//! earlier. Where the voxels are separable (`voxelSeparable`) a ray runs along an axis alone,
//! through one of the six faces, one side before the face and as far past the voxel's other: a hit
//! counts only within the voxel's depth. Its point across the face is drawn from a side before the
//! centre's to the centre's, on each axis — the reference draws it so, half of them lying outside
//! the voxel's column. Ray `k` of set `s` is the point of index `s · rays + k`, its bits reversed,
//! from seed 0. A voxel casting one ray alone (`VoxelSampling::single`) draws it from the Morton
//! code of its cell on a grid of 1 024 cells a side (`lone_ray`); a separable one tests three axis
//! rays through its centre instead (`Sampler::crosshair`).
use super::raster::Cell;
use super::sample::FACES;
use super::VoxelSampling;
use std::borrow::Cow;
use std::f64::consts::TAU;
use std::sync::OnceLock;
use trillion3d_math::sequence::sobol::{evolve_seed, sobol_point};
use trillion3d_math::vector::vec3::{cross, dominant_axis, frame_across};
use trillion3d_math::vector::vecn::{add, scale};
use trillion3d_page_codec::partition::morton3;

/// Sets of rays the voxels take in turn, by their rank (`Sampler::set`): neighbours sample with
/// other rays, so a pattern of the set never repeats across a wall.
const VARIATIONS: usize = 64;

/// One ray of a set, in voxel sides from the voxel's centre: its direction, where it starts, how
/// far it runs, the face it is counted on — its direction's main axis, face `2a` for a ray along
/// `+a` —, the weight of its hit — one over the rays its set counts on that face — and the
/// footprint its texture is filtered over, an eighth of a side each way: all of it once a set,
/// never once a voxel.
#[derive(Clone)]
pub(super) struct Ray {
    pub(super) direction: [f64; 3],
    pub(super) enter: [f64; 3],
    pub(super) length: f64,
    pub(super) face: usize,
    pub(super) weight: f64,
    pub(super) footprint: [[f64; 3]; 2],
}

impl Ray {
    /// The ray from `enter` along `direction`, `length` long, counted on `face`; `across` is the
    /// frame's first axis across `direction` (`frame_across`), its footprint's.
    fn new(
        direction: [f64; 3],
        across: [f64; 3],
        (enter, length): ([f64; 3], f64),
        face: usize,
    ) -> Self {
        let edge = scale(across, 1.0 / 8.0);
        Self {
            direction,
            enter,
            length,
            face,
            weight: 1.0,
            footprint: [edge, cross(direction, edge)],
        }
    }
}

/// A set of rays and, per face, how many it counts on it.
#[derive(Clone)]
pub(super) struct RaySet {
    pub(super) rays: Vec<Ray>,
    pub(super) per_face: [usize; FACES],
}

/// What a voxel's rays are drawn from: the sets of rays the voxels take in turn — none for a voxel
/// that casts one ray — and the three rays of a crosshair. Only the rays asked for, whether they
/// are separable and how far back they start shape the sets (`VoxelSampling::casts_like`).
#[derive(Clone)]
pub(super) struct Sampler {
    pub(super) sets: Vec<RaySet>,
    pub(super) crosshair: [Ray; 3],
}

/// The sampler of the defaults' rays, drawn once for the process: a build naming none of the
/// settings that shape the rays shares it.
static DEFAULTS: OnceLock<Sampler> = OnceLock::new();

impl Sampler {
    /// The sampler of `sampling`'s rays: the shared one when they are the defaults', else drawn.
    pub(super) fn of(sampling: &VoxelSampling) -> Cow<'static, Self> {
        let defaults = VoxelSampling::default();
        match sampling.casts_like(&defaults) {
            true => Cow::Borrowed(DEFAULTS.get_or_init(|| Self::new(&defaults))),
            false => Cow::Owned(Self::new(sampling)),
        }
    }

    fn new(sampling: &VoxelSampling) -> Self {
        let sets = match sampling.single() {
            true => Vec::new(),
            false => (0..VARIATIONS as u32)
                .map(|set| ray_set(set, sampling))
                .collect(),
        };
        let along = |axis: usize| {
            let (mut direction, mut enter) = ([0.0; 3], [0.0; 3]);
            (direction[axis], enter[axis]) = (1.0, -0.5);
            Ray::new(direction, frame_across(direction), (enter, 1.0), 2 * axis)
        };
        Self {
            sets,
            crosshair: [0, 1, 2].map(along),
        }
    }

    /// The set the voxel of rank `rank` takes its rays from: the voxels of a group are ranked in
    /// the order its triangles find them (`cells`), and take the sets in turn.
    pub(super) fn set(&self, rank: u32) -> &RaySet {
        &self.sets[rank as usize % VARIATIONS]
    }
}

/// The one ray a voxel casts alone: the point of its cell's Morton code on a grid of 1 024 cells
/// a side, its bits reversed, so the voxels around it cast other rays.
pub(super) fn lone_ray(cell: Cell) -> Ray {
    random(morton3(cell.map(|c| c as u32)).reverse_bits(), 0.0)
}

/// The set `set` of `sampling.rays()` rays, each weighing its hit one over those its face counts.
fn ray_set(set: u32, sampling: &VoxelSampling) -> RaySet {
    let count = sampling.rays() as u32;
    let mut rays: Vec<Ray> = (0..count)
        .map(|k| {
            let index = (set * count + k).reverse_bits();
            match sampling.separable {
                true => aligned(index),
                false => random(index, sampling.back_up),
            }
        })
        .collect();
    let mut per_face = [0usize; FACES];
    for ray in &rays {
        per_face[ray.face] += 1;
    }
    for ray in &mut rays {
        ray.weight = 1.0 / per_face[ray.face] as f64;
    }
    RaySet { rays, per_face }
}

/// The ray of point `index` in a random direction, starting `back_up` sides before the cube: the
/// line, drawn again from the moved seed until it crosses the cube.
fn random(index: u32, back_up: f64) -> Ray {
    let mut seed = 0;
    loop {
        let [e, f] = sobol_point(index, &mut seed);
        let (z, turn) = (1.0 - 2.0 * e, TAU * f);
        let ring = (1.0 - z * z).sqrt();
        let direction = [ring * turn.cos(), ring * turn.sin(), z];
        let [e, f] = sobol_point(index, &mut seed);
        let (radius, angle) = (e.sqrt() * 0.5 * 3f64.sqrt(), TAU * f);
        let across = frame_across(direction);
        let other = cross(direction, across);
        let origin = add(
            scale(across, radius * angle.cos()),
            scale(other, radius * angle.sin()),
        );
        let (mut entry, mut exit) = (f64::NEG_INFINITY, f64::INFINITY);
        for (k, d) in direction.iter().enumerate() {
            let (near, far) = match *d == 0.0 {
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
            let enter = add(origin, scale(direction, entry - back_up));
            let axis = dominant_axis(direction);
            let face = 2 * axis + usize::from(direction[axis] < 0.0);
            return Ray::new(direction, across, (enter, exit - entry + back_up), face);
        }
    }
}

/// The ray of point `index` along an axis, through a face of the cube the index and the seed pick
/// (an odd face runs up its axis, an even one down): a side before the face, three long, at a
/// point across it from a side before the centre's to the centre's on each axis.
fn aligned(index: u32) -> Ray {
    let mut seed = 0;
    let pick = index.wrapping_add(evolve_seed(&mut seed)) % FACES as u32;
    let (z, sign) = ((pick >> 1) as usize, if pick & 1 == 1 { 1.0 } else { -1.0 });
    // The axes across the one it runs along, in a turn: 0 then 1 and 2, 1 then 2 and 0, 2 then 0
    // and 1.
    let x = (1 << z) & 3;
    let y = (1 << x) & 3;
    let [e, f] = sobol_point(index, &mut seed);
    let mut enter = [0.0; 3];
    (enter[x], enter[y]) = (e - 1.0, f - 1.0);
    enter[z] = -1.5 * sign;
    let mut direction = [0.0; 3];
    direction[z] = sign;
    let face = 2 * z + usize::from(sign < 0.0);
    Ray::new(direction, frame_across(direction), (enter, 3.0), face)
}

#[cfg(test)]
mod tests {
    use super::super::sample::{Cast, Caster, Probe};
    use super::*;
    use crate::trace::surface::material::Surface;
    use crate::trace::surface::mesh::Corners;
    use crate::trace::surface::Traceable;
    use crate::trace::tracer::Among;

    /// A mesh of two quads, each two triangles, over x in 0..0.5 and y in 0..1: the target at
    /// z = 0.5, inside the voxel `[0, 0, 0]` of side 1, and an occluder at z = -0.5 in the voxel
    /// below it, which does not overlap the voxel.
    fn target_and_occluder() -> Traceable {
        let quad = |z: f32| {
            let corner = |x: f32, y: f32| [x, y, z];
            let (a, b, c, d) = (
                corner(0.0, 0.0),
                corner(0.5, 0.0),
                corner(0.5, 1.0),
                corner(0.0, 1.0),
            );
            [a, b, c, a, c, d].concat()
        };
        let triangles = [quad(0.5), quad(-0.5)].concat();
        let corners = (0..4).map(|_| Corners::default()).collect();
        let surface = Surface::of(&serde_json::json!({}), None, &[]);
        Traceable::new(triangles, vec![0; 4], corners, vec![surface])
    }

    // Behaviour: a ray whose nearest hit lies in its back-up stretch is left out of the voxel's
    // count — neither a hit nor a miss —, where one backed up by less, or an occluder out of the
    // stretch, leaves it a hit: the occluder here is a side and a half under the voxel's centre,
    // outside the voxel.
    #[test]
    fn a_backed_up_ray_met_before_its_voxel_is_left_out_of_the_count() {
        let mesh = target_and_occluder();
        let near = [0.0; 4];
        let sampling = VoxelSampling::default();
        let sampler = Sampler::of(&sampling);
        let probe = Probe {
            mesh: &mesh,
            near: &near,
            tie: mesh.tie(),
            sampling,
            sampler: &sampler,
        };
        // Up the target's column, from `z` (voxel sides from the centre of voxel `[0, 0, 0]`).
        let ray = |z: f64| Ray {
            direction: [0.0, 0.0, 1.0],
            enter: [-0.25, -0.25, z],
            length: 0.5 - z,
            face: 4,
            weight: 1.0,
            footprint: [[0.0; 3]; 2],
        };
        let cast = |ranks: &[u32], ray: Ray, window: (f64, f64)| {
            let among = Among {
                ranks,
                near: &near,
                from: 0.0,
                tie: probe.tie,
            };
            let caster = Caster {
                probe: &probe,
                among,
                centre: [0.5; 3],
                side: 1.0,
            };
            caster.cast(&ray, window)
        };
        let (everything, target) = ([0, 1, 2, 3], [0, 1]);
        // Backed up a side before the voxel's bottom: the occluder, half a side from the start,
        // lies in the stretch; without it the ray hits the target.
        let backed_up = (1.0, f64::INFINITY);
        assert!(matches!(
            cast(&everything, ray(-1.5), backed_up),
            Cast::Left
        ));
        assert!(matches!(cast(&target, ray(-1.5), backed_up), Cast::Hit(_)));
        // Not backed up, the occluder is behind the start: the ray hits the target.
        let open = (0.0, f64::INFINITY);
        assert!(matches!(cast(&everything, ray(-0.5), open), Cast::Hit(_)));
    }
}
