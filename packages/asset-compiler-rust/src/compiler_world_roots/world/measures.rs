//! The world box, tracing, the working bytes and the measures of a run.
use super::super::flatten::{self, Shell};
use super::*;
use super::{min_visible, StepMs, STEPS};
use crate::HlodLayer;

/// `instance`'s box in world space: its cover's box placed by its matrix.
fn world_box(instance: &Instance) -> ([f64; 3], [f64; 3]) {
    use trillion3d_math::box_transform::box_transform;
    use trillion3d_page_codec::proxy::bvh::extent;
    let mut world = [0.0; 6];
    box_transform(
        &mut world,
        &extent(&instance.cover.positions),
        &instance.matrix,
    );
    (
        [world[0], world[1], world[2]],
        [world[3], world[4], world[5]],
    )
}

/// Whether HLOD `level`'s bake traces `instance`: every object at HLOD 1, whose shell it also
/// makes; above it, one whose box in world space (`world_box`) spans at least a pixel where the
/// level is first seen (`min_visible`, `flatten::pixel_at`) — a smaller one shows in no texel
/// there, and the shell it bakes onto is the layer below's, not the objects'.
pub(super) fn traced(instance: &Instance, level: usize) -> bool {
    if level == 1 {
        return true;
    }
    let (low, high) = world_box(instance);
    let diagonal = trillion3d_math::aabb::diagonal(low, high);
    // A box no matrix places (not a number) is traced, as an object of unknown size.
    diagonal.is_nan() || diagonal >= flatten::pixel_at(min_visible(level))
}

/// The faces of the solid a source face makes, at most: a thin part thickened shows two
/// (`approximate::scene`).
const FACES: f64 = 2.0;

/// The bytes the actor `shell` — layer `hlod` — of HLOD `level` of the objects `members` holds
/// while it is made (`flatten::working_bytes`): the triangles the bake traces — the objects' it
/// traces (`traced`) — and
/// those the shell approximates — the objects' again at HLOD 1, the `below` triangles of the closed
/// meshes of the actors under it above it —, within the objects' bounds in world space, the skin
/// of their solid, its images cooked for `families` block families.
///
/// The skin is the area the solid's surface shows the grid's three axes — the cells it crosses
/// per square cell —, per object the least of two: twice the area its faces show the axes (`FACES`,
/// each triangle's area vector placed by its matrix's cofactor, `cofactor_direction`, its three
/// components' magnitudes summed), and the surface of its box in world space, which holds the
/// solid its faces close — a tower's floors, inside its walls, never reach the surface.
pub(super) fn working_bytes(
    instances: &[Instance],
    (level, shell, hlod, families): (usize, Shell, &HlodLayer, usize),
    (members, below): (&[usize], usize),
) -> usize {
    use trillion3d_math::aabb::{half_area, merge_aabb};
    use trillion3d_math::linear::cofactor_direction;
    use trillion3d_math::vec3::{cross, point};
    use trillion3d_math::vecn::sub;
    let bake_triangles: usize = (members.iter())
        .filter(|&&i| traced(&instances[i], level))
        .map(|&i| instances[i].cover.indices.len() / 3)
        .sum();
    let approximated = if level == 1 { bake_triangles } else { below };
    let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    let mut skin = 0.0;
    for &i in members {
        let (cover, matrix) = (instances[i].cover, &instances[i].matrix);
        let axes = |n: [f64; 3]| n.iter().map(|x| x.abs()).sum::<f64>();
        let (placed, own) = (cover.indices.as_chunks::<3>().0.iter())
            .map(|t| {
                let [a, b, c] = t.map(|v| point(&cover.positions, v));
                let normal = cross(sub(b, a), sub(c, a)).map(|x| 0.5 * x);
                (axes(cofactor_direction(matrix, normal)), axes(normal))
            })
            .fold((0.0, 0.0), |(p, o), (x, y)| (p + x, o + y));
        // A matrix that is not finite places nothing: the object's own.
        let shown = if placed.is_finite() { placed } else { own };
        let (box_low, box_high) = world_box(&instances[i]);
        // A box no matrix places (not finite) widens nothing: the estimate stays bounded.
        if box_low.iter().chain(&box_high).all(|x| x.is_finite()) {
            merge_aabb(&mut low, &mut high, box_low, box_high);
        }
        let surface = 2.0 * half_area(box_low, box_high);
        let faces = FACES * shown;
        skin += if surface.is_finite() {
            faces.min(surface)
        } else {
            faces
        };
    }
    flatten::working_bytes(
        (bake_triangles + approximated, skin),
        (low, high),
        (shell, hlod, min_visible(level), families),
    )
}

/// A cell whose actor could not be made: its HLOD level, its cell and the reason.
pub(crate) type Failure = (usize, usize, &'static str);

/// What the making measured, per HLOD level from 1: each step's milliseconds summed over its
/// actors (`STEPS`), its shells' triangles after each step summed over the actors made and, apart,
/// over those that failed (`flatten::Stages`), and the most triangles one actor made holds, where
/// a crumpled shell shows; over the whole graph, the cores it kept busy — the process's CPU time
/// over its wall time — and the most estimated bytes it ran at once over the growth of the
/// process's resident bytes — above one, the estimates leave cores idle; below, the memory passes
/// what they promised (`compiler_budget::admission::Admitted`).
#[derive(Default)]
pub(crate) struct Measures {
    pub step_ms: Vec<StepMs>,
    pub stages: Vec<flatten::Stages>,
    pub failed_stages: Vec<flatten::Stages>,
    pub most_triangles: Vec<usize>,
    /// Per level, the mean tone gap of its flattened actors (`Spent`); none without one.
    pub tone_gap: Vec<Option<[f64; 2]>>,
    pub parallelism: Option<f64>,
    pub estimate_over_peak: Option<f64>,
}

impl Measures {
    /// Each step's milliseconds per level, by its name (`STEPS`).
    pub(crate) fn steps(&self) -> Value {
        let named = (STEPS.iter().enumerate()).map(|(k, name)| {
            (
                name.to_string(),
                json!(self.step_ms.iter().map(|ms| ms[k]).collect::<Vec<_>>()),
            )
        });
        Value::Object(named.collect())
    }
}
