//! The primitives of a job compiled side by side, as many at once as its budget admits, beside the
//! world transforms and mesh scales they are cut by.
use super::*;
use crate::compiler::args::mesh_build::MeshBuild;
use crate::compiler::budget::admission::{run_admitted, Admitted, Done, Room};
use crate::compiler::primitive::cost::climb_working;
use crate::compiler::source::assembly::plan::AssemblyPlan;
use crate::compiler::source::node_transform::Mat4;
use crate::dag::assembly::RootCover;
use crate::displace::Bakes;

/// The roots the compiled parts of a carrier handed on (`CompiledPrimitive::cover`), by primitive.
type Covers<'d> = BTreeMap<(usize, usize), &'d RootCover>;

/// What `compile_primitives` returns: every node's world transform, the
/// primitives compiled — those of the jobs that build one (`compile_job`), in the jobs' order —,
/// and how many of them waited for room.
type Compiled = (Vec<Mat4>, Vec<CompiledPrimitive>, usize);

/// Every node's world transform, every primitive of `jobs` compiled on
/// `pool`, as many at once as their `working` sets fit `room` together, and the primitives the
/// room made wait. `assignments` is each node's HLOD layer (`Hlod::assignments`).
pub(super) fn compile_primitives(
    (o, g, bin, pool): (&Options, &Value, &[u8], &rayon::ThreadPool),
    (jobs, working, room): (&[(usize, usize)], &[usize], usize),
    (chosen, mesh_map, accessors): Selected<'_>,
    (mesh_builds, bakes, bake_cap): (&[MeshBuild], &Bakes<'_>, usize),
    assignments: &[Assigned],
    progress: &(impl Fn(Value) + Sync),
) -> Result<Compiled> {
    // Compact per-page index storage is bounded independently from source size. Metadata is retained.
    // Every node's world transform, walked once for every stage that places (`Placement`), and
    // each mesh's world scale, read before the loop: the bundles' bands are in metres.
    let world = crate::compiler::source::node_transform::world_matrices(g)?;
    let mut mesh_scales = proxy::placement::mesh_scales(g, chosen, &world)?;
    // A fallback mesh is placed at the scale of the mesh it stands for.
    let stands_for = fallback_sources(g, mesh_map);
    for (&fallback, source) in &stands_for {
        if let Some(&scale) = mesh_scales.get(source) {
            mesh_scales.insert(fallback, scale);
        }
    }
    let hlod = o.hlod()?;
    let voxelized = o.voxelize()?.meshes(g, hlod, assignments)?;
    // What the merged layers take, and of which meshes: once, for every primitive.
    let mut merged: crate::compiler::primitive::Merged = BTreeMap::new();
    if let Some(taken) = crate::hlod::chain::merged_lods(o) {
        for mesh in hlod.merged_meshes(g, chosen, assignments)? {
            merged.insert(mesh, taken);
        }
    }
    // The meshes a fallback mesh stands for give their fallback (`source/fallback.rs`).
    for source in stands_for.values() {
        let own = merged.get(source).and_then(|t| t.calculate);
        let taken = crate::hlod::flatten::merge::Taken {
            calculate: own,
            lowest: true,
        };
        merged.insert(*source, taken);
    }
    let merged = (!merged.is_empty()).then_some(merged);
    let plan = AssemblyPlan::of(g, jobs)?;
    // Each fallback job and the job of the same primitive of its source mesh.
    let sources: BTreeMap<(usize, usize), (usize, usize)> = (jobs.iter())
        .filter_map(|&(mesh, primitive)| {
            Some(((mesh, primitive), (*stands_for.get(&mesh)?, primitive)))
        })
        .collect();
    let no_fallbacks = BTreeMap::new();
    let no_covers = BTreeMap::new();
    let primitive_inputs = PrimitiveInputs {
        o,
        g,
        bin,
        mesh_values: values(g, "meshes")?,
        mesh_map,
        voxelized: &voxelized,
        merged: merged.as_ref(),
        fallbacks: &no_fallbacks,
        mesh_builds,
        bakes,
        bake_cap,
        mesh_scales: &mesh_scales,
        assemblies: &plan,
        covers: &no_covers,
        validated: accessors,
        progress,
    };
    let (compiled, admission) = pool.install(|| {
        run_jobs(
            &plan,
            (jobs, working, room),
            &sources,
            |i, covers, fallbacks| {
                let inputs = PrimitiveInputs {
                    covers,
                    fallbacks,
                    ..primitive_inputs
                };
                compile_job(&inputs, &jobs[i])
            },
        )
    })?;
    let compiled = compiled.into_iter().flatten().collect();
    Ok((world, compiled, admission.waited))
}

/// Every job of `jobs` compiled by `compile`, which is handed the job's rank and the roots the
/// compiled parts of a carrier handed on, as many at once as their working sets fit `room`. A
/// primitive that carries an assembly's levels runs after the primitives of the parts whose roots
/// it climbs over, and reads them; it is admitted for its own working set and for that climb
/// (`admitted_bytes`), known once the parts are compiled. The results in the jobs' order, none for
/// a job that builds none.
fn run_jobs(
    plan: &AssemblyPlan,
    (jobs, working, room): (&[(usize, usize)], &[usize], usize),
    sources: &BTreeMap<(usize, usize), (usize, usize)>,
    compile: impl Fn(usize, &Covers<'_>, &Fallbacks) -> Result<Option<CompiledPrimitive>> + Sync,
) -> Result<(Vec<Option<CompiledPrimitive>>, Admitted)> {
    let rank: BTreeMap<(usize, usize), usize> = (jobs.iter().copied().enumerate())
        .map(|(at, job)| (job, at))
        .collect();
    let after: Vec<Vec<usize>> = (jobs.iter())
        .map(|job| {
            let mut after = parts_of(plan, &rank, job);
            after.extend(sources.get(job).and_then(|source| rank.get(source)));
            after
        })
        .collect();
    run_admitted(
        &after,
        (Room::Fixed(room), None),
        |i, done| admitted_bytes(plan, &rank, (&jobs[i], working[i]), done),
        |i, done| {
            let fallbacks = fallbacks_of(sources, &rank, &jobs[i], done);
            compile(i, &covers_of(plan, &rank, &jobs[i], done), &fallbacks)
        },
    )
}

/// The displacement each source mesh of `g` bakes into its triangles, by its rank: the maps its
/// settings name, for a mesh that is compiled and names a trimmed error, none for any other. All
/// its triangle primitives bake as one soup, the map of each the one of its rank. The images are
/// read when a primitive asks for them (`Bakes`).
pub(super) fn displacements<'a>(
    scene: (&'a Value, &'a [u8], &'a Path),
    mesh_map: &BTreeMap<usize, usize>,
    mesh_builds: &'a [MeshBuild],
) -> Bakes<'a> {
    let named = mesh_builds.iter().enumerate().map(|(old, build)| {
        let wanted = !build.displacement.is_off() && build.trim.trimmed_error > 0.0;
        (wanted && mesh_map.contains_key(&old)).then_some(&build.displacement)
    });
    Bakes::new(named, scene)
}

/// The fallbacks the compiled source of a fallback job handed on (`CompiledPrimitive::source_cover`),
/// by fallback job: none for any other job.
type Fallbacks = BTreeMap<(usize, usize), crate::hlod::chain::SourceCover>;

/// The mesh each fallback mesh of `mesh_map` stands for (`source/fallback.rs`), by fallback.
fn fallback_sources(g: &Value, mesh_map: &BTreeMap<usize, usize>) -> BTreeMap<usize, usize> {
    let meshes = g["meshes"].as_array().into_iter().flatten().enumerate();
    meshes
        .filter(|(rank, _)| mesh_map.contains_key(rank))
        .filter_map(|(rank, mesh)| Some((rank, crate::compiler::source::fallback::of(mesh)?)))
        .collect()
}

/// The fallback of the source of `job`, a fallback job, once the source is compiled.
fn fallbacks_of<'d>(
    sources: &BTreeMap<(usize, usize), (usize, usize)>,
    rank: &BTreeMap<(usize, usize), usize>,
    job: &(usize, usize),
    done: &'d Done<'d, Option<CompiledPrimitive>>,
) -> Fallbacks {
    let source = sources.get(job).and_then(|source| rank.get(source));
    let compiled = source.and_then(|&at| done.get(at).as_ref());
    // A source that kept no fallback leaves the job to build as its source does.
    compiled
        .and_then(|c| c.source_cover.lods.fallback_cover())
        .map(|cover| (*job, cover))
        .into_iter()
        .collect()
}

/// The ranks among the jobs of the primitives of the parts whose roots the carrier `job` climbs
/// over, in order, none for a primitive that carries no levels.
fn parts_of(
    plan: &AssemblyPlan,
    rank: &BTreeMap<(usize, usize), usize>,
    job: &(usize, usize),
) -> Vec<usize> {
    let uses = plan.carriers.get(job).into_iter().flatten();
    let mut parts: Vec<usize> = uses
        .filter_map(|joined| rank.get(&joined.part).copied())
        .collect();
    parts.sort_unstable();
    parts.dedup();
    parts
}

/// The roots the compiled parts of the carrier `job` handed on (`CompiledPrimitive::cover`), one
/// for each instance it takes: the primitive of its part and its roots. A part that handed on none
/// — it has no roots, or its job built none — names no instance.
fn part_covers<'d>(
    plan: &'d AssemblyPlan,
    rank: &'d BTreeMap<(usize, usize), usize>,
    job: &(usize, usize),
    done: &'d Done<'d, Option<CompiledPrimitive>>,
) -> impl Iterator<Item = ((usize, usize), &'d RootCover)> + 'd {
    let uses = plan.carriers.get(job).into_iter().flatten();
    uses.filter_map(move |joined| {
        let part = done.get(*rank.get(&joined.part)?).as_ref()?;
        Some((joined.part, part.cover.as_ref()?))
    })
}

/// The roots the compiled parts of the carrier `job` handed on, by primitive.
fn covers_of<'d>(
    plan: &'d AssemblyPlan,
    rank: &'d BTreeMap<(usize, usize), usize>,
    job: &(usize, usize),
    done: &'d Done<'d, Option<CompiledPrimitive>>,
) -> Covers<'d> {
    part_covers(plan, rank, job, done).collect()
}

/// What `job` is admitted for: its glTF primitive's working set, `working`, and, for a carrier, the
/// climb over the roots of its instances' parts, which only the compiled parts tell
/// (`climb_working`: each instance lays its own copy of them).
fn admitted_bytes<'d>(
    plan: &'d AssemblyPlan,
    rank: &'d BTreeMap<(usize, usize), usize>,
    (job, working): (&(usize, usize), usize),
    done: &'d Done<'d, Option<CompiledPrimitive>>,
) -> usize {
    let roots = part_covers(plan, rank, job, done)
        .map(|(_, cover)| (cover.indices.len() / 3, cover.positions.len() / 3));
    working.saturating_add(climb_working(roots))
}

/// The chosen nodes, the compacted rank of each source mesh and the accessors already validated.
pub(super) type Selected<'a> = (
    &'a BTreeSet<usize>,
    &'a BTreeMap<usize, usize>,
    &'a BTreeSet<usize>,
);

#[cfg(test)]
mod tests;
