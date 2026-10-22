//! The primitives of a job compiled side by side, as many at once as its budget admits, beside the
//! world transforms and mesh scales they are cut by.
use super::*;
use crate::compiler::args::mesh_build::MeshBuild;
use crate::compiler::budget::admission::{run_admitted, Done, Room};
use crate::compiler::primitive::triangles;
use crate::compiler::source::assembly::plan::AssemblyPlan;
use crate::compiler::source::node_transform::Mat4;
use crate::dag::assembly::RootCover;
use crate::displace::DisplacementSettings;

/// What `compile_primitives` returns: every node's world transform, each mesh's world scale, the
/// primitives compiled, and how many of them waited for room.
type Compiled = (
    Vec<Mat4>,
    BTreeMap<usize, f64>,
    Vec<CompiledPrimitive>,
    usize,
);

/// Every node's world transform, each mesh's world scale, every primitive of `jobs` compiled on
/// `pool`, as many at once as their `working` sets fit `room` together, and the primitives the
/// room made wait. `assignments` is each node's HLOD layer (`Hlod::assignments`).
pub(super) fn compile_primitives(
    (o, g, bin, image_root, pool): (&Options, &Value, &[u8], &Path, &rayon::ThreadPool),
    (jobs, working, room): (&[(usize, usize)], &[usize], usize),
    (chosen, mesh_map, unique_triangles, accessors): Selected<'_>,
    assignments: &[Assigned],
    progress: &(impl Fn(Value) + Sync),
) -> Result<Compiled> {
    // Compact per-page index storage is bounded independently from source size. Metadata is retained.
    // Every node's world transform, walked once for every stage that places (`Placement`), and
    // each mesh's world scale, read before the loop: the proxy threshold is in metres.
    let world = crate::compiler::source::node_transform::world_matrices(g)?;
    let mesh_scales = proxy::placement::mesh_scales(g, chosen, &world)?;
    let hlod = o.hlod()?;
    let voxelized = o.voxelize()?.meshes(g, hlod, assignments)?;
    // What the merged layers take, and of which meshes: once, for every primitive.
    let merged = match crate::hlod::chain::merged_lods(o) {
        Some(taken) => Some((hlod.merged_meshes(g, chosen, assignments)?, taken)),
        None => None,
    };
    let mesh_builds = o.mesh_build()?.meshes(g)?;
    let named = (mesh_builds.iter().enumerate()).map(|build| displacement_of(g, mesh_map, build));
    let bakes = crate::displace::load_bakes(named, (g, bin, image_root))?;
    let plan = AssemblyPlan::of(g, jobs)?;
    let no_covers = BTreeMap::new();
    let primitive_inputs = PrimitiveInputs {
        o,
        g,
        bin,
        mesh_values: values(g, "meshes")?,
        mesh_map,
        voxelized: &voxelized,
        merged: merged.as_ref(),
        mesh_builds: &mesh_builds,
        bakes: &bakes,
        mesh_scales: &mesh_scales,
        assemblies: &plan,
        covers: &no_covers,
        scene_triangles: unique_triangles,
        validated: accessors,
        progress,
    };
    // As many primitives at once as their working sets fit the job's budget (`plan_buffers`); a
    // primitive that carries an assembly's levels runs after the primitives of the parts whose
    // roots it climbs over, and reads them.
    let rank: BTreeMap<(usize, usize), usize> = (jobs.iter().copied().enumerate())
        .map(|(at, job)| (job, at))
        .collect();
    let after: Vec<Vec<usize>> = jobs.iter().map(|job| parts_of(&plan, &rank, job)).collect();
    let (compiled, admission) = pool.install(|| {
        run_admitted(
            &after,
            (Room::Fixed(room), None),
            |i, _| working[i],
            |i, done| {
                let covers = covers_of(&plan, &rank, &jobs[i], done);
                let inputs = PrimitiveInputs {
                    covers: &covers,
                    ..primitive_inputs
                };
                compile_job(&inputs, &jobs[i])
            },
        )
    })?;
    Ok((world, mesh_scales, compiled, admission.waited))
}

/// The displacement source mesh `old` bakes into its triangles (`build`'s), none for a mesh that
/// is not compiled, names no map or no trimmed error, or has not exactly one triangle primitive:
/// the displacement's maps are those of the mesh's materials, which a mesh of several primitives
/// shares none of.
fn displacement_of<'a>(
    g: &Value,
    mesh_map: &BTreeMap<usize, usize>,
    (old, build): (usize, &'a MeshBuild),
) -> Option<&'a DisplacementSettings> {
    let named = !build.displacement.is_off() && build.trim.trimmed_error > 0.0;
    let one = || triangles::mesh_primitives(g, old).is_ok_and(|primitives| primitives.count() == 1);
    (named && mesh_map.contains_key(&old) && one()).then_some(&build.displacement)
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

/// The roots the compiled parts of the carrier `job` handed on (`CompiledPrimitive::cover`), by
/// primitive.
fn covers_of(
    plan: &AssemblyPlan,
    rank: &BTreeMap<(usize, usize), usize>,
    job: &(usize, usize),
    done: &Done<'_, CompiledPrimitive>,
) -> BTreeMap<(usize, usize), RootCover> {
    let mut covers = BTreeMap::new();
    for part in plan
        .carriers
        .get(job)
        .into_iter()
        .flatten()
        .map(|joined| joined.part)
    {
        let cover = rank.get(&part).and_then(|&at| done.get(at).cover.as_ref());
        covers.extend(cover.map(|cover| (part, cover.clone())));
    }
    covers
}

/// The chosen nodes, the compacted rank of each source mesh, the scene's unique triangles and the
/// accessors already validated.
pub(super) type Selected<'a> = (
    &'a BTreeSet<usize>,
    &'a BTreeMap<usize, usize>,
    usize,
    &'a BTreeSet<usize>,
);
