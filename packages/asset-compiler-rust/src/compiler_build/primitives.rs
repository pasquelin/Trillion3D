//! The primitives of a job compiled side by side, as many at once as its budget admits, beside the
//! world transforms and mesh scales they are cut by.
use super::*;
use crate::compiler_budget::admission::{alone, run_admitted, Room};
use crate::compiler_world::Mat4;

/// Every node's world transform, each mesh's world scale, every primitive of `jobs` compiled on
/// `pool`, as many at once as their `working` sets fit `room` together, and the primitives the
/// room made wait.
pub(super) fn compile_primitives(
    (o, g, bin, pool): (&Options, &Value, &[u8], &rayon::ThreadPool),
    (jobs, working, room): (&[(usize, usize)], &[usize], usize),
    (chosen, mesh_map, unique_triangles, accessors): Selected<'_>,
    progress: &(impl Fn(Value) + Sync),
) -> Result<(
    Vec<Mat4>,
    BTreeMap<usize, f64>,
    Vec<CompiledPrimitive>,
    usize,
)> {
    // Compact per-page index storage is bounded independently from source size. Metadata is retained.
    // Every node's world transform, walked once for every stage that places (`Placement`), and
    // each mesh's world scale, read before the loop: the proxy threshold is in metres.
    let world = compiler_world::world_matrices(g)?;
    let mesh_scales = proxy::placement::mesh_scales(g, chosen, &world)?;
    let voxelized = o.voxelize()?.meshes(g, o.hlod()?)?;
    let primitive_inputs = PrimitiveInputs {
        o,
        g,
        bin,
        mesh_values: values(g, "meshes")?,
        mesh_map,
        voxelized: &voxelized,
        mesh_scales: &mesh_scales,
        scene_triangles: unique_triangles,
        validated: accessors,
        progress,
    };
    // As many primitives at once as their working sets fit the job's budget (`plan_buffers`).
    let (compiled, admission) = pool.install(|| {
        run_admitted(
            &alone(jobs.len()),
            Room::Fixed(room),
            |i, _| working[i],
            |i, _| compile_job(&primitive_inputs, &jobs[i]),
        )
    })?;
    Ok((world, mesh_scales, compiled, admission.waited))
}

/// The chosen nodes, the compacted rank of each source mesh, the scene's unique triangles and the
/// accessors already validated.
pub(super) type Selected<'a> = (
    &'a BTreeSet<usize>,
    &'a BTreeMap<usize, usize>,
    usize,
    &'a BTreeSet<usize>,
);
