//! The world's jobs: every actor of every level, each job reading its cell's original objects
//! alone, never another job's result.
use super::super::merge::WorldDag;
use super::super::pages::encode_pages;
use super::super::place::{conform, empty, triangles};
use super::super::voxels;
use super::actors::{
    approximated_actor, merged_actors, merged_bytes, simplified_actor, simplified_bytes,
};
use super::instanced::{actor_rows, split, ActorRows};
use super::measures::{gathered, working_bytes, Failure, Measures};
use super::*;
use crate::compiler::budget::admission::{alone, run_admitted, Done, Room};
use crate::compiler::tables::partition::HlodNode;
use crate::hlod::flatten::Recipe;
use std::sync::atomic::{AtomicUsize, Ordering};

/// What `world_dag` makes: the world DAG, its actors, each cell's rows, the cells whose actor could
/// not be made, and what the making measured.
type WorldBuild = (WorldDag, Vec<Actor>, ActorRows, Vec<Failure>, Measures);

/// The world DAG of `instances` over the chain `tree` (`HlodNode`, leaves first), its actors, each
/// cell's rows and the cells whose actor could not be made: per cell whose actor a job layer builds
/// (`HlodNode::actor`), that layer's actors — HLOD 0 per main cell of a layer not
/// instanced, HLOD 1 per HLOD 0 cell, then each next level up to each chain's top —, each made of
/// the cell's original objects, a cell of a chain's last grid building none; its objects standing
/// as themselves — an instanced layer's every one — the rows of its actor, nothing built of them
/// (`instanced::actor_rows`). The clusters of actor `k` wear what it wears (`Wears`), and name `k`.
/// In culling order, its pages written; with what the making measured.
pub(crate) fn world_dag(
    instances: &[Instance],
    tree: &[HlodNode],
    builder: &Builder,
) -> Result<WorldBuild> {
    let started = std::time::Instant::now();
    let cpu = crate::support::perf::rss::cpu_ms();
    let layers = &builder.hlod.layers;
    // The job layer that builds the actor of cell `cell`; none for a cell of a chain's last grid.
    let built_by = |cell: usize| tree[cell].actor.map(|p| &layers[p]);
    // Each cell's members — its original objects: every instance under it, through every level
    // between — at every level at once, by cell, each list in the instances' order: the chain
    // lists each level's cells after the level below's, so the cells' order is the layers'.
    let mut members: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (i, instance) in instances.iter().enumerate() {
        if instance.cover.indices.is_empty() {
            continue;
        }
        let mut cell = Some(instance.hlod);
        while let Some(at) = cell {
            if built_by(at).is_some() {
                members.entry(at).or_default().push(i);
            }
            cell = tree[at].parent;
        }
    }
    // The objects standing as themselves in each cell's actor are its rows, nothing built of them;
    // the others its job's, when its layer builds a mesh (`Recipe::of`).
    let mut rows: ActorRows = vec![Vec::new(); tree.len()];
    let mut jobs: Vec<(usize, Recipe, Vec<usize>)> = Vec::new();
    for (cell, objects) in members {
        let layer = built_by(cell).expect("a cell whose layer builds actors");
        let builds = layer.builder;
        let (built, standing) = split(instances, &objects, builds);
        rows[cell] = actor_rows(instances, &standing);
        if let Some(recipe) = Recipe::of(builds).filter(|_| !built.is_empty()) {
            jobs.push((cell, recipe, built));
        }
    }
    let families = builder.o.texture_formats.len();
    let hlod_of = |job: usize| built_by(jobs[job].0).expect("a cell whose layer builds actors");
    let level_of = |job: usize| tree[jobs[job].0].actor_level;
    // Where each job's actor is first drawn: its cell's grid range (`HlodNode::seen_from`).
    let seen_of = |job: usize| tree[jobs[job].0].seen_from;
    // Each job's bytes, from the original objects it reads alone: no job reads another's result.
    let estimate = |job: usize, _: &Done<Job>| {
        let (hlod, members) = (hlod_of(job), &jobs[job].2);
        match jobs[job].1 {
            Recipe::Voxel => voxels::working_bytes(instances, members),
            Recipe::Shell => working_bytes(instances, (hlod, families), members),
            Recipe::Merge => merged_bytes(instances, (hlod, families, builder.library), members),
            Recipe::Simplified => simplified_bytes(instances, (hlod, families), members),
        }
    };
    // Each level's jobs from HLOD 0, told once at the start, and the jobs ended, of all and of the
    // job's level, told as each job ends: a long cook shows where it stands.
    let levels = tree
        .iter()
        .map(|node| node.actor_level + 1)
        .max()
        .unwrap_or(0);
    let mut level_jobs = vec![0usize; levels];
    (0..jobs.len()).for_each(|job| level_jobs[level_of(job)] += 1);
    let level_ended: Vec<AtomicUsize> = (0..levels).map(|_| AtomicUsize::new(0)).collect();
    let ended = AtomicUsize::new(0);
    // A job ended: its level, cell, builder and wall milliseconds with the counts.
    let told = |(level, cell): (usize, usize), name: &str, started: std::time::Instant| {
        let level_completed = level_ended[level].fetch_add(1, Ordering::Relaxed) + 1;
        let completed = ended.fetch_add(1, Ordering::Relaxed) + 1;
        (builder.progress)(
            json!({"phase": "hlod", "completed": completed, "total": jobs.len(),
            "level": level, "levelCompleted": level_completed, "cell": cell, "builder": name,
            "ms": crate::shared_math::elapsed_ms(started)}),
        );
    };
    (builder.progress)(json!({"phase": "hlod", "completed": 0, "total": jobs.len(),
        "levelTotals": level_jobs}));
    // A job: its cell's actors, made of its original objects alone, whatever its level.
    let make = |job: usize, _: &Done<Job>| -> Result<Job> {
        let started = std::time::Instant::now();
        (builder.checkpoint)()?;
        let (cell, recipe, members) = (jobs[job].0, jobs[job].1, jobs[job].2.as_slice());
        let (hlod, level, seen) = (hlod_of(job), level_of(job), seen_of(job));
        let made = match recipe {
            Recipe::Voxel => {
                let library = (builder.library, builder.checkpoint);
                let made = voxels::voxel_actor(instances, (seen, cell), members, library)?;
                let mut spent = Spent::default();
                spent.ms[VOXEL] = crate::hlod::flatten::millis(started);
                Job {
                    made: made.map(|actor| vec![actor]),
                    spent,
                }
            }
            Recipe::Shell => approximated_actor(instances, (seen, cell), hlod, members, builder)?,
            Recipe::Merge => merged_actors(instances, (seen, cell), hlod, members, builder)?,
            Recipe::Simplified => {
                simplified_actor(instances, (seen, cell), hlod, members, builder)?
            }
        };
        told((level, cell), hlod.builder.name(), started);
        Ok(made)
    };
    // Each job's rank on the critical path: its own work — no job reads another's, so no work
    // waits on it —, its objects' triangles, a shell's weighing more (`SHELL_WEIGHT`): the longest
    // starts first, and the last to end is never a long one started late.
    let rank: Vec<u64> = (0..jobs.len())
        .map(|job| {
            let weight = match jobs[job].1 {
                Recipe::Shell | Recipe::Simplified => SHELL_WEIGHT,
                Recipe::Merge | Recipe::Voxel => 1,
            };
            triangles(instances, &jobs[job].2) as u64 * weight
        })
        .collect();
    let room = (Room::Measured(builder.room), Some(rank.as_slice()));
    let (made, admitted) = run_admitted(&alone(jobs.len()), room, estimate, make)?;
    let placed = |job: usize| (jobs[job].0, level_of(job));
    let (mut actors, failures, mut measures) = gathered(made, levels, &placed);
    measures.waited = admitted.waited;
    measures.most_bytes = admitted.most;
    let wall = crate::shared_math::elapsed_ms(started);
    let spent = crate::support::perf::rss::cpu_ms()
        .zip(cpu)
        .map(|(now, then)| now - then);
    measures.parallelism = spent.map(|cpu| cpu / wall.max(1.0));
    measures.estimate_over_peak = (admitted.measured)
        .filter(|&measured| measured > 0.0)
        .map(|measured| 1.0 / measured);
    // Every attribute an actor carries: a flattened actor its normals and atlas coordinates — an
    // approximated one its tangents too —, a merged one the texture sets of its sources
    // (`merge::sections`).
    let layout = (actors.iter())
        .flat_map(|actor| actor.built.2.iter().map(|a| a.flag))
        .fold(FLAG_NORMAL | FLAG_UV, |flags, flag| flags | flag);
    let mut world = WorldDag {
        carried: empty(layout),
        ..WorldDag::default()
    };
    for actor in actors.iter_mut() {
        let (dag, positions, carried, extents) = std::mem::take(&mut actor.built);
        // The world's attributes on the actor's vertices, zeros for one it lacks.
        let arrays = conform(carried, layout, positions.len() / 3);
        let arrays: Vec<&Attribute> = arrays.iter().collect();
        let voxels = std::mem::take(&mut actor.voxels);
        world.splice(dag, (&positions, &arrays), (voxels, actor.cell), extents);
    }
    // The pages first: their bytes are what the assignment weighs, whose fill order the clusters
    // take (`WorldDag::in_culling_order`).
    (world.pages, world.decoded) = encode_pages(&world)?;
    world.in_culling_order((tree, builder.hlod))?;
    Ok((world, actors, rows, failures, measures))
}

/// How much heavier a shell's or a simplified job weighs per triangle on the critical path than a
/// merged or voxel one: either passes over its cell in each of its steps — field, march, close,
/// simplify, unwrap, bake — where a merge concatenates its sources once; all then build a DAG. A
/// coarse prior that only orders the jobs, never a measure.
const SHELL_WEIGHT: u64 = 4;
