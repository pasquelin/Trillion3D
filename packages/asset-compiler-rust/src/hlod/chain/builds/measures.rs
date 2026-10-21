//! The world box, the working bytes and the measures of a run.
use super::super::place::triangles;
use super::*;
use super::{Actor, Job, StepMs, STEPS, STEP_COUNT};
use crate::HlodLayer;

/// `instance`'s box in world space: its cover's box placed by its matrix.
fn world_box(instance: &Instance) -> ([f64; 3], [f64; 3]) {
    use trillion3d_math::geometry::box_transform::box_transform;
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

/// The cells across their bounds' longest side the skin of a shell's sources is counted on: the
/// most the solid's grid ever takes, so a cell of the count is never wider than the solid's
/// (`approximate::solid::voxel_target`).
const SKIN_CELLS: f64 = 1024.0;

/// The triangles one task of the skin's count rasterizes at once: neighbours in their object's
/// order, their cells deduplicated before they join the others'.
const SKIN_CHUNK: usize = 4096;

/// The area the solid of the objects `members` within `bounds` shows the grid's three axes — the
/// cells its surface crosses per square cell —, counted as the march counts the cells it starts
/// from (`approximate::solid::seed`): every cell of a grid `SKIN_CELLS` cells across the bounds'
/// longest side that one of their triangles crosses, placed in world space, once however many
/// cross it, times a cell's square. Two buildings side by side share the cells of their party
/// walls, an object inside another's walls the cells they cross: summed object by object, both
/// faces of each, they were counted again.
fn skin(instances: &[Instance], members: &[usize], (low, high): ([f64; 3], [f64; 3])) -> f64 {
    use rayon::prelude::*;
    use trillion3d_math::matrix::transform_point;
    use trillion3d_math::vector::vec3::point;
    use trillion3d_math::vector::vecn::sub;
    let cell = trillion3d_math::geometry::aabb::longest_side(low, high) / SKIN_CELLS;
    // No bounds — no object a matrix places — show no skin.
    if !(cell.is_finite() && cell > 0.0) {
        return 0.0;
    }
    let count: [i32; 3] = std::array::from_fn(|k| ((high[k] - low[k]) / cell).ceil() as i32 + 1);
    let chunks: Vec<(usize, usize)> = (members.iter())
        .flat_map(|&i| {
            let triangles = instances[i].cover.indices.len() / 3;
            (0..triangles.div_ceil(SKIN_CHUNK)).map(move |chunk| (i, chunk))
        })
        .collect();
    let mut cells: Vec<[i32; 3]> = (chunks.par_iter())
        .flat_map_iter(|&(i, chunk)| {
            let (cover, matrix) = (instances[i].cover, &instances[i].matrix);
            // A corner placed in world space, about the grid's low corner.
            let placed = |v: u32| sub(transform_point(matrix, point(&cover.positions, v)), low);
            let triangles = cover.indices.as_chunks::<3>().0;
            let end = ((chunk + 1) * SKIN_CHUNK).min(triangles.len());
            let mut out = Vec::new();
            for t in &triangles[chunk * SKIN_CHUNK..end] {
                crate::voxel::triangle_cells(t.map(placed), cell, Some(count), |c| out.push(c));
            }
            out.sort_unstable();
            out.dedup();
            out
        })
        .collect();
    cells.par_sort_unstable();
    cells.dedup();
    cells.len() as f64 * cell * cell
}

/// The bytes the actor approximated layer `hlod` makes of its cell's original objects `members`
/// holds while it is made, whatever its level (`flatten::working_bytes`): their triangles, which
/// the shell approximates and its bake reads, the same pieces twice (`approximated_actor`), within
/// their bounds in world space, the skin of their solid (`skin`: the cells their triangles cross,
/// each once), its images cooked for `families` block families.
pub(crate) fn working_bytes(
    instances: &[Instance],
    (hlod, families): (&HlodLayer, usize),
    members: &[usize],
) -> usize {
    use trillion3d_math::geometry::aabb::merge_aabb;
    let approximated = triangles(instances, members);
    let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for &i in members {
        let (box_low, box_high) = world_box(&instances[i]);
        // A box no matrix places (not finite) widens nothing: the estimate stays bounded.
        if box_low.iter().chain(&box_high).all(|x| x.is_finite()) {
            merge_aabb(&mut low, &mut high, box_low, box_high);
        }
    }
    let skin = skin(instances, members, (low, high));
    crate::hlod::flatten::working_bytes(
        (approximated.saturating_mul(2), skin),
        (low, high),
        (hlod, families),
    )
}

/// A cell whose actor could not be made: its HLOD level, its cell and the reason.
pub(crate) type Failure = (usize, usize, &'static str);

/// What the making measured, per HLOD level from 0: each step's milliseconds summed over its
/// actors (`STEPS`), its shells' triangles after each step summed over the actors made and, apart,
/// over those that failed (`flatten::Stages`), and the most triangles one actor made holds, where
/// a crumpled shell shows, and its voxel actors' voxels and bricks; over all the jobs, the cores
/// it kept busy — the process's CPU time over its wall time —, the jobs the room made wait, the
/// most estimated bytes it ran at once and those over the growth of the process's resident bytes —
/// above one, the estimates leave cores idle; below, the memory passes what they promised
/// (`compiler::budget::admission::Admitted`).
#[derive(Default)]
pub(crate) struct Measures {
    pub step_ms: Vec<StepMs>,
    pub stages: Vec<crate::hlod::flatten::Stages>,
    pub failed_stages: Vec<crate::hlod::flatten::Stages>,
    pub most_triangles: Vec<usize>,
    /// Per level, the mean tone gap of its flattened actors (`Spent`); none without one.
    pub tone_gap: Vec<Option<[f64; 2]>>,
    pub voxels: Vec<usize>,
    pub bricks: Vec<usize>,
    pub parallelism: Option<f64>,
    pub waited: usize,
    pub most_bytes: usize,
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

/// Every job's actors of `made` in the jobs' order, each cell whose actor could not be made, and
/// what the jobs measured per level of `levels`; `placed` gives a job's cell and level.
pub(super) fn gathered(
    made: Vec<Job>,
    levels: usize,
    placed: &dyn Fn(usize) -> (usize, usize),
) -> (Vec<Actor>, Vec<Failure>, Measures) {
    let count: usize = (made.iter())
        .map(|job| job.made.as_ref().map_or(0, Vec::len))
        .sum();
    let mut measures = Measures {
        step_ms: vec![[0; STEP_COUNT]; levels],
        stages: vec![[0; crate::hlod::flatten::STAGE_COUNT]; levels],
        failed_stages: vec![[0; crate::hlod::flatten::STAGE_COUNT]; levels],
        most_triangles: vec![0; levels],
        voxels: vec![0; levels],
        bricks: vec![0; levels],
        ..Measures::default()
    };
    let mut tone_gaps = vec![([0.0; 2], 0usize); levels];
    let (mut actors, mut failures) = (Vec::with_capacity(count), Vec::new());
    for (job, Job { made, spent }) in made.into_iter().enumerate() {
        // Its level is its rank in each measure: they count from HLOD 0.
        let (cell, at) = placed(job);
        let stages = match made {
            Ok(made) => {
                for actor in made {
                    measures.most_triangles[at] = measures.most_triangles[at].max(actor.triangles);
                    for page in &actor.voxels {
                        measures.voxels[at] += page.voxels;
                        measures.bricks[at] += page.bricks;
                    }
                    actors.push(actor);
                }
                &mut measures.stages[at]
            }
            Err(reason) => {
                failures.push((at, cell, reason));
                &mut measures.failed_stages[at]
            }
        };
        stages
            .iter_mut()
            .zip(spent.stages)
            .for_each(|(total, step)| *total += step);
        if let Some([luminance, hue]) = spent.tone_gap {
            let (sum, count) = &mut tone_gaps[at];
            *sum = [sum[0] + luminance, sum[1] + hue];
            *count += 1;
        }
        (measures.step_ms[at].iter_mut())
            .zip(spent.ms)
            .for_each(|(total, ms)| *total += ms);
    }
    measures.tone_gap = (tone_gaps.into_iter())
        .map(|(sum, count)| (count > 0).then(|| sum.map(|total| total / count as f64)))
        .collect();
    (actors, failures, measures)
}
