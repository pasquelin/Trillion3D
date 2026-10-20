//! The `voxel` layer's actors: per cell, its objects voxelized together — no shell, no atlas —,
//! level after level from the pixel where the cell is first seen until one brick holds it
//! (`voxel::cell_levels`), each object read through its material, a leaf card's cut-out letting
//! the rays through, the levels' bricks the actor's pages and the cut swapping them by their error
//! (`voxel::voxel_dag`). A cell above HLOD 1 takes its children's levels as fine as it is first
//! seen and coarser, where they were made; it voxelizes itself only the objects of a child whose
//! actor failed. The actor wears the material of its first opaque object: a voxel row reads its
//! lighting alone, its voxels their own colour.
use super::flatten::sources::{traceable, Piece};
use super::flatten::{self, mesh_merge::Material, Library};
use super::place::gather;
use super::world::{min_visible, Actor, Wears};
use super::*;
use crate::dag::append_dag;
use crate::voxel::{cell_levels, voxel_dag, VoxelLevel, VoxelPage};
use std::sync::Mutex;

/// The bytes a voxel job holds per triangle it traces: its corners, attributes and tracer node.
const TRACED_BYTES: usize = 400;
/// The bytes one core holds while it samples a tile of voxels: up to 32³ voxels and their sums.
const TILE_BYTES: usize = 64 << 20;

/// The bytes the voxel actor of the objects `members` holds while it is made: the triangles it
/// traces, and a tile per core.
pub(super) fn working_bytes(instances: &[Instance], members: &[usize]) -> usize {
    let traced: usize = (members.iter())
        .map(|&i| instances[i].cover.indices.len() / 3)
        .sum();
    traced * TRACED_BYTES + TILE_BYTES * rayon::current_num_threads()
}

/// The levels of the objects `members` from side `first`, in world space through their materials.
fn levels_of(
    instances: &[Instance],
    members: &[usize],
    first: f64,
    (library, checkpoint): (&Library, &(dyn Fn() -> Result<()> + Sync)),
) -> Result<Vec<VoxelLevel>> {
    let placed: Vec<(Option<u64>, (Vec<f32>, Vec<_>, Vec<u32>))> = (members.iter())
        .map(|&i| (instances[i].material, gather(&instances[i])))
        .collect();
    let pieces: Vec<Piece> = (placed.iter())
        .map(|(material, (positions, carried, indices))| Piece {
            material: Material::Source(*material),
            positions,
            carried,
            indices,
        })
        .collect();
    let mesh = traceable(&pieces, (library, &BTreeMap::new()));
    drop(placed);
    cell_levels(&mesh, first, checkpoint)
}

/// A child's levels as fine as `first` and coarser: from the finest at least `first` wide, or its
/// coarsest where none is.
fn coarser(levels: &[VoxelLevel], first: f64) -> Vec<VoxelLevel> {
    let from = (levels.iter())
        .position(|level| level.side >= first * (1.0 - 1e-9))
        .unwrap_or(levels.len().saturating_sub(1));
    levels[from..].to_vec()
}

/// The voxel actor of cell `cell` at HLOD `level`: of its objects `members` at HLOD 1, above it of
/// its children's levels `children` and of the objects `orphans` no child stands for; `Err` with
/// the reason when it holds no voxel or no opaque material.
pub(super) fn voxel_actor(
    instances: &[Instance],
    (level, cell): (usize, usize),
    (members, children, orphans): (&[usize], &[&Actor], &[usize]),
    (library, checkpoint): (&Library, &(dyn Fn() -> Result<()> + Sync)),
) -> Result<std::result::Result<Actor, &'static str>> {
    let opaque = (members.iter()).find_map(|&i| {
        let surface = library.surface(instances[i].material);
        (!surface.blend && surface.transmission <= 0.0).then_some(instances[i].material)
    });
    let Some(material) = opaque else {
        return Ok(Err("no opaque material under the voxels"));
    };
    let first = flatten::pixel_at(min_visible(level));
    let mut parts: Vec<Vec<VoxelLevel>> = (children.iter())
        .filter_map(|child| child.levels.as_deref())
        .map(|levels| coarser(levels, first))
        .collect();
    let own = if level == 1 { members } else { orphans };
    if !own.is_empty() {
        parts.push(levels_of(instances, own, first, (library, checkpoint))?);
    }
    let parts: Vec<Vec<VoxelLevel>> = parts.into_iter().filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return Ok(Err("no voxel under the cell"));
    }
    let (mut clusters, mut groups, mut positions) = (Vec::new(), Vec::new(), Vec::new());
    let mut pages: Vec<VoxelPage> = Vec::new();
    for part in &parts {
        let dag = voxel_dag(part);
        let vertex_base = (positions.len() / 3) as u32;
        append_dag(
            (&mut clusters, &mut groups),
            (dag.clusters, dag.groups),
            vertex_base,
        );
        positions.extend(dag.positions);
        pages.extend(dag.pages);
    }
    let voxels = pages.iter().map(|p| p.voxels).sum();
    // Levels a layer above reads: those of a cell this one's parent voxelizes too.
    let kept = parts.into_iter().reduce(|mut all, part| {
        merge_levels(&mut all, part);
        all
    });
    Ok(Ok(Actor {
        cell,
        built: ((clusters, groups), positions, Vec::new()),
        wears: Wears::Merged(Material::Source(material)),
        atlas: Mutex::new(None),
        triangles: voxels,
        voxels: pages,
        levels: kept,
    }))
}

/// `part`'s levels added to `all`'s of the same side, those past its coarsest appended: the
/// levels a cell above reads of several parts, side by side on one grid.
fn merge_levels(all: &mut Vec<VoxelLevel>, part: Vec<VoxelLevel>) {
    for level in part {
        match all
            .iter_mut()
            .find(|l| (l.side - level.side).abs() <= 1e-9 * level.side)
        {
            Some(same) => same.bricks.extend(level.bricks),
            None => all.push(level),
        }
    }
    all.sort_by(|a, b| a.side.total_cmp(&b.side));
}
