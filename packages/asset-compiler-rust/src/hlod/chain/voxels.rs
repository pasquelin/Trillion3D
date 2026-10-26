//! The `voxel` layer's actors: per cell, whatever its level, its original objects — every object
//! under it, never an actor below — voxelized together — no shell, no atlas —, level after level
//! from the pixel where the cell is first seen until one brick holds it (`voxel::cell_levels`),
//! sampled as the layer's `meshBuild` says (`voxel::VoxelSettings`), each object read through its
//! material, a leaf card's cut-out letting the rays through, the
//! levels' bricks the actor's pages and the cut swapping them by their error (`voxel::voxel_dag`).
//! The actor wears the material of its first opaque object: a voxel row reads its lighting alone,
//! its voxels their own colour.
use super::builds::{Actor, Wears};
use super::place::{objects, triangles};
use super::*;
use crate::hlod::flatten::bake::sources::traceable;
use crate::hlod::flatten::{pieces, Library};
use crate::voxel::{cell_levels, voxel_dag, VoxelLevel, VoxelSettings};

/// The bytes a voxel job holds per triangle it traces: its corners, attributes and tracer node.
const TRACED_BYTES: usize = 400;
/// The bytes one core holds while it samples a tile of voxels: up to 32³ voxels and their sums.
const TILE_BYTES: usize = 64 << 20;

/// The bytes the voxel actor of the objects `members` holds while it is made: the triangles it
/// traces, and a tile per core.
pub(crate) fn working_bytes(instances: &[Instance], members: &[usize]) -> usize {
    triangles(instances, members) * TRACED_BYTES + TILE_BYTES * rayon::current_num_threads()
}

/// The levels of the objects `members` from side `first`, in world space through their
/// materials, sampled as `settings` say.
fn levels_of(
    instances: &[Instance],
    (members, settings): (&[usize], VoxelSettings),
    first: f64,
    (library, checkpoint): (&Library, &(dyn Fn() -> Result<()> + Sync)),
) -> Result<Vec<VoxelLevel>> {
    let placed = objects(instances, members);
    let mesh = traceable(&pieces(&placed), library);
    drop(placed);
    cell_levels(&mesh, first, settings, checkpoint)
}

/// The voxel actor of cell `cell`, first drawn `seen` metres away (`HlodNode::seen_from`), of its
/// original objects `members`, whatever its level, its voxels sampled as `settings` say; `Err`
/// with the reason when it holds no voxel or no opaque material.
pub(super) fn voxel_actor(
    instances: &[Instance],
    (seen, cell): (f64, usize),
    (members, settings): (&[usize], VoxelSettings),
    (library, checkpoint): (&Library, &(dyn Fn() -> Result<()> + Sync)),
) -> Result<std::result::Result<Actor, &'static str>> {
    let opaque = (members.iter()).find_map(|&i| {
        let surface = library.surface(instances[i].material);
        (!surface.blend && surface.transmission <= 0.0).then_some(instances[i].material)
    });
    let Some(material) = opaque else {
        return Ok(Err("no opaque material under the voxels"));
    };
    let first = crate::hlod::flatten::pixel_at(seen);
    let levels = levels_of(instances, (members, settings), first, (library, checkpoint))?;
    if levels.is_empty() {
        return Ok(Err("no voxel under the cell"));
    }
    let dag = voxel_dag(&levels);
    Ok(Ok(Actor {
        cell,
        built: (
            (dag.clusters, dag.groups),
            dag.positions,
            Vec::new(),
            Vec::new(),
        ),
        wears: Wears::Merged(material),
        triangles: 0,
        voxels: dag.pages,
        field: None,
        cards: None,
    }))
}
