//! The DAG as built, read before its finest detail is cut away and as it is cut
//! (`build_dag_primitive`): what the later stages of a primitive's compile take of it.
use crate::compiler::primitive::climb::Role;
use crate::dag::{DagCluster, DagGroup, DagStall, DagStrategy, GroupTally};
use crate::hlod::chain::SourceCover;
use crate::*;
use trillion3d_page_codec::bits::grid::{PageGrid, Precision};

/// What the DAG as built gives: its report and the warnings it makes, the world's HLOD level 0 and
/// the LODs a merged layer takes, the voxels' seed and the grid
/// its pages' vertices lie on.
pub(super) struct Read {
    pub dag_report: Value,
    pub warnings: Vec<Value>,
    pub source_cover: SourceCover,
    pub voxel_seed: crate::voxel::VoxelSeed,
    pub grid: PageGrid,
}

/// The DAG as built, `dag` and `groups`, read. The report and the world's HLOD read it before its
/// finest detail is cut away (`role.trim`) — the report its levels and stalls, the HLOD its level
/// 0, without the stored tangents, which its placed copies would not turn —; the voxels' seed after. The grid follows every cluster the build made, the finest detail the
/// trim cuts away included.
pub(super) fn read_dag(
    (strategy, role): (DagStrategy, Role),
    precision: Precision,
    (dag, groups): (&mut Vec<DagCluster>, &mut Vec<DagGroup>),
    (pos, carried, indices, triangle_source): (&[f32], &[&encode::Attribute], &[u32], &[u32]),
    (tallies, stalls): (&[GroupTally], &[DagStall]),
) -> Result<Read> {
    let (dag_report, warnings) = stalls::dag_report(strategy, &dag[..], tallies, stalls);
    let untangled: Vec<&encode::Attribute> = (carried.iter().copied())
        .filter(|a| a.flag != trillion3d_page_codec::FLAG_TANGENT)
        .collect();
    let source_cover =
        SourceCover::of((&dag[..], &groups[..]), (pos, &untangled[..]), role.merged)?;
    let extents = crate::dag::cut_finest(role.trim, (&mut *dag, &mut *groups), pos, indices);
    let seeded = (pos, indices, triangle_source);
    let voxel_seed = crate::voxel::VoxelSeed::of(&dag[..], &groups[..], seeded, role.shape);
    // The pages quantize every vertex, placed or not, from where it truly is, on the grid the
    // clusters the build made call for.
    let grid = crate::geometry_page::quant::page_grid(precision, &extents)?;
    Ok(Read {
        dag_report,
        warnings,
        source_cover,
        voxel_seed,
        grid,
    })
}
