//! The world graph: every actor of every level as jobs.
use super::super::flatten::{self, Recipe};
use super::super::merge::WorldDag;
use super::super::pages::encode_pages;
use super::super::place::{conform, empty, gather};
use super::super::voxels;
use super::actors::{approximated_actor, merged_actors, merged_bytes, take_worn, worn_sizes};
use super::measures::{working_bytes, Failure, Measures};
use super::*;
use super::{children_of, lock, Actor, Builder, Job, Spent, Wears, ACTORS_PER_JOB, STEP_COUNT};
use crate::compiler_budget::admission::{run_admitted, Done, Room};
use crate::compiler_tables::partition::HlodNode;
use flatten::mesh_merge::Material;
use std::sync::Mutex;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_NORMAL, FLAG_UV};

/// The world DAG of `instances` over the chain `tree` (`HlodNode`, leaves first), its actors and
/// the cells whose actor could not be made: per cell whose actor a job layer builds
/// (`HlodNode::actor_layer`), that layer's actors — HLOD 1 per HLOD 0 cell, then each next level up
/// to each chain's top, a short chain's top built once more on the `TOP_LEVEL` grid —, a cell of
/// objects in no layer building none; the clusters of actor `k` wear what it wears (`Wears`), and
/// name `k`. In culling order, its pages written; with what the making measured.
pub(crate) fn world_dag(
    instances: &[Instance],
    tree: &[HlodNode],
    builder: &Builder,
) -> Result<(WorldDag, Vec<Actor>, Vec<Failure>, Measures)> {
    let started = std::time::Instant::now();
    let cpu = crate::perf::rss::cpu_ms();
    let layers = &builder.hlod.layers;
    // The job layer that builds the actor of cell `cell`; none for a cell of objects in no layer.
    let built_by = |cell: usize| tree[cell].actor_layer(builder.hlod).map(|p| &layers[p]);
    // The builder of the layer that reads cell `cell`'s actors.
    let above = |cell: usize| {
        tree[cell]
            .parent
            .and_then(built_by)
            .map(|layer| layer.builder)
    };
    // Each cell's members — the instances under it — at every level at once, by cell: the chain
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
    let jobs: Vec<(usize, Vec<usize>)> = members.into_iter().collect();
    let job_of: BTreeMap<usize, usize> = (jobs.iter().enumerate())
        .map(|(job, &(cell, _))| (cell, job))
        .collect();
    // Each job's inputs: the jobs of the cells right below its cell, in order.
    let mut inputs: Vec<Vec<usize>> = vec![Vec::new(); jobs.len()];
    for (job, &(cell, _)) in jobs.iter().enumerate() {
        if let Some(&parent) = tree[cell].parent.and_then(|p| job_of.get(&p)) {
            inputs[parent].push(job);
        }
    }
    // The closed meshes each job leaves the layer above, taken by the job that reads them.
    let closed: Vec<Mutex<Vec<flatten::Placed>>> =
        (0..jobs.len()).map(|_| Mutex::new(Vec::new())).collect();
    // A child that closed no mesh — its actor failed — leaves its own objects in its place, as at
    // HLOD 1: the shell above never stands with a hole where it was.
    let below_of = |child: usize| -> Vec<flatten::Placed> {
        let left = std::mem::take(&mut *lock(&closed[child]));
        if !left.is_empty() {
            return left;
        }
        (jobs[child].1.iter())
            .map(|&i| {
                let (positions, _, indices) = gather(&instances[i]);
                (positions, indices)
            })
            .collect()
    };
    let families = builder.o.texture_formats.len();
    // The objects of a voxel job no child actor stands for: every member at HLOD 1, above it those
    // of the children whose actor failed — or that were never made.
    let orphans_of = |job: usize, done: &Done<Job>| -> Vec<usize> {
        if inputs[job].is_empty() {
            return jobs[job].1.clone();
        }
        let covered: BTreeSet<usize> = (inputs[job].iter())
            .filter(|&&child| done.get(child).made.is_ok())
            .flat_map(|&child| jobs[child].1.iter().copied())
            .collect();
        (jobs[job].1.iter())
            .filter(|i| !covered.contains(i))
            .copied()
            .collect()
    };
    let hlod_of = |job: usize| built_by(jobs[job].0).expect("a cell whose layer builds actors");
    let level_of = |job: usize| tree[jobs[job].0].actor_level();
    let estimate = |job: usize, done: &Done<Job>| {
        let (hlod, members) = (hlod_of(job), jobs[job].1.as_slice());
        match Recipe::of(hlod.builder) {
            Recipe::Voxel => voxels::working_bytes(instances, &orphans_of(job, done)),
            Recipe::Shell(shell) => {
                let below: usize = (inputs[job].iter())
                    .map(|&child| {
                        let held = lock(&closed[child]);
                        if held.is_empty() {
                            // Its own objects stand in for a child that closed no mesh.
                            let objects = jobs[child].1.iter();
                            return objects
                                .map(|&i| instances[i].cover.indices.len() / 3)
                                .sum::<usize>();
                        }
                        held.iter()
                            .map(|(_, indices)| indices.len() / 3)
                            .sum::<usize>()
                    })
                    .sum();
                let on = (level_of(job), shell, hlod, families);
                working_bytes(instances, on, (members, below))
            }
            Recipe::Merge => {
                let children = children_of(&inputs[job], done);
                let atlases = worn_sizes(&children, done);
                let on = (level_of(job), hlod, families);
                merged_bytes(instances, on, (members, &children, &atlases))
            }
        }
    };
    let make = |job: usize, done: &Done<Job>| -> Result<Job> {
        (builder.checkpoint)()?;
        let (cell, members) = (jobs[job].0, jobs[job].1.as_slice());
        let (hlod, level, above) = (hlod_of(job), level_of(job), above(cell));
        let (made, left) = match Recipe::of(hlod.builder) {
            Recipe::Voxel => {
                let children: Vec<&Actor> = (children_of(&inputs[job], done).into_iter())
                    .map(|(_, actor)| actor)
                    .collect();
                let orphans = orphans_of(job, done);
                let on = (members, children.as_slice(), orphans.as_slice());
                let library = (builder.library, builder.checkpoint);
                let made = voxels::voxel_actor(instances, (level, cell), on, library)?;
                let made = made.map(|actor| vec![actor]);
                (
                    Job {
                        made,
                        spent: Spent::default(),
                    },
                    Vec::new(),
                )
            }
            Recipe::Shell(shell) => {
                let below: Vec<flatten::Placed> =
                    inputs[job].iter().flat_map(|&c| below_of(c)).collect();
                let on = (shell, hlod, above);
                approximated_actor(instances, (level, cell), on, (members, &below), builder)?
            }
            Recipe::Merge => {
                let children = children_of(&inputs[job], done);
                // Only a job that merges its materials reads its children's atlases.
                let atlases = if hlod.merge_materials {
                    take_worn(&children, done)
                } else {
                    BTreeMap::new()
                };
                let merged = (members, children.as_slice(), atlases);
                merged_actors(instances, (level, cell), (hlod, above), merged, builder)?
            }
        };
        *lock(&closed[job]) = left;
        Ok(made)
    };
    let (made, admitted) = run_admitted(&inputs, Room::Measured(builder.room), estimate, make)?;
    // Every job's actors ranked in the jobs' order, their ids turned into those ranks.
    let mut first = Vec::with_capacity(made.len());
    let mut count = 0;
    for job in &made {
        first.push(count);
        count += job.made.as_ref().map_or(0, Vec::len);
    }
    let rank = |id: usize| first[id / ACTORS_PER_JOB] + id % ACTORS_PER_JOB;
    let levels = tree.iter().map(HlodNode::actor_level).max().unwrap_or(0);
    let mut measures = Measures {
        step_ms: vec![[0; STEP_COUNT]; levels],
        stages: vec![[0; flatten::STAGE_COUNT]; levels],
        failed_stages: vec![[0; flatten::STAGE_COUNT]; levels],
        most_triangles: vec![0; levels],
        ..Measures::default()
    };
    let mut tone_gaps = vec![([0.0; 2], 0usize); levels];
    let (mut actors, mut failures) = (Vec::with_capacity(count), Vec::new());
    for (job, Job { made, spent }) in made.into_iter().enumerate() {
        let (cell, level) = (jobs[job].0, level_of(job));
        let at = level - 1;
        let stages = match made {
            Ok(made) => {
                for mut actor in made {
                    // No layer reads an atlas, nor a voxel actor's levels, once the graph is done.
                    *actor.atlas.get_mut().unwrap_or_else(|e| e.into_inner()) = None;
                    actor.levels = None;
                    if let Wears::Merged(Material::Actor(id)) = actor.wears {
                        actor.wears = Wears::Merged(Material::Actor(rank(id)));
                    }
                    measures.most_triangles[at] = measures.most_triangles[at].max(actor.triangles);
                    actors.push(actor);
                }
                &mut measures.stages[at]
            }
            Err(reason) => {
                failures.push((level, cell, reason));
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
    let wall = crate::shared_math::elapsed_ms(started);
    let spent = crate::perf::rss::cpu_ms()
        .zip(cpu)
        .map(|(now, then)| now - then);
    measures.parallelism = spent.map(|cpu| cpu / wall.max(1.0));
    measures.estimate_over_peak = (admitted.measured)
        .filter(|&measured| measured > 0.0)
        .map(|measured| 1.0 / measured);
    // Every attribute an actor carries: a flattened actor its normals and atlas coordinates, a
    // merged one the texture sets of its sources (`mesh_merge::sections`).
    let layout = (actors.iter())
        .flat_map(|actor| actor.built.2.iter().map(|a| a.flag))
        .fold(FLAG_NORMAL | FLAG_UV, |flags, flag| flags | flag);
    let mut world = WorldDag {
        carried: empty(layout),
        ..WorldDag::default()
    };
    for actor in actors.iter_mut() {
        let (dag, positions, carried) = std::mem::take(&mut actor.built);
        // The world's attributes on the actor's vertices, zeros for one it lacks.
        let arrays = conform(carried, layout, positions.len() / 3);
        let arrays: Vec<&Attribute> = arrays.iter().collect();
        let voxels = std::mem::take(&mut actor.voxels);
        world.splice(dag, (&positions, &arrays), (voxels, actor.cell));
    }
    world.in_culling_order();
    world.pages = encode_pages(&world)?;
    Ok((world, actors, failures, measures))
}
